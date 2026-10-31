import {
  FLUID_METHOD_CAPABILITIES,
  FluidError,
  FluidErrorCode,
  isGrantableCapability,
  isPermissionExpired,
  type FluidCapability,
  type FluidCreateSessionParams,
  type FluidMethodName,
  type FluidPermission,
  type FluidPermissionRequest,
  type FluidSession,
} from "@fluid-wallet/protocol";

/** Grants default to a week: long enough to be useful, short enough to expire quietly. */
export const DEFAULT_GRANT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_SESSION_TTL_MS = 60 * 60 * 1000;

/**
 * Standing permissions, keyed by origin.
 *
 * This is the only place allowed to decide whether an origin may call a method.
 * The SDK never enforces anything: a compromised page must be denied inside the
 * trusted runtime, which is exactly here.
 */
export class PermissionStore {
  readonly #byOrigin = new Map<string, FluidPermission>();
  readonly #now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  grant(
    origin: string,
    request: FluidPermissionRequest,
    options: { ttlMs?: number | null } = {},
  ): FluidPermission {
    const capabilities = request.capabilities.filter(isGrantableCapability);
    const rejected = request.capabilities.filter((capability) => !isGrantableCapability(capability));

    if (rejected.length > 0) {
      throw new FluidError(
        FluidErrorCode.PermissionDenied,
        `These capabilities cannot be granted to a web origin: ${rejected.join(", ")}.`,
      );
    }
    if (capabilities.length === 0) {
      throw new FluidError(FluidErrorCode.InvalidParams, "At least one capability is required.");
    }

    const grantedAt = this.#now();
    // `null` is "until revoked"; `undefined` falls back to the default week.
    const ttl = options.ttlMs === undefined ? DEFAULT_GRANT_TTL_MS : options.ttlMs;
    const permission: FluidPermission = {
      origin,
      appId: request.appId,
      providers: request.providers ?? [],
      models: request.models,
      capabilities,
      grantedAt,
      ...(ttl === null ? {} : { expiresAt: grantedAt + ttl }),
    };

    this.#byOrigin.set(origin, permission);
    return permission;
  }

  /** Returns the live grant, or null when it never existed or has expired. */
  get(origin: string): FluidPermission | null {
    const permission = this.#byOrigin.get(origin);
    if (!permission) return null;
    if (isPermissionExpired(permission, this.#now())) {
      this.#byOrigin.delete(origin);
      return null;
    }
    return permission;
  }

  /** Live grants, newest first. Used to rehydrate persisted connections. */
  list(): FluidPermission[] {
    return [...this.#byOrigin.values()]
      .filter((permission) => !isPermissionExpired(permission, this.#now()))
      .sort((left, right) => right.grantedAt - left.grantedAt);
  }

  /**
   * Reinstates a permission loaded from storage.
   *
   * Unlike `grant`, this trusts the saved record verbatim — the persisted
   * record already went through the approval flow, and re-running it would
   * silently extend the expiry.
   */
  restore(permission: FluidPermission): void {
    if (isPermissionExpired(permission, this.#now())) return;
    this.#byOrigin.set(permission.origin, permission);
  }

  revoke(origin: string): boolean {
    return this.#byOrigin.delete(origin);
  }

  /**
   * Drops a subset of capabilities from a grant.
   *
   * An app can narrow its own access without losing the rest of the grant;
   * when nothing is left the record is removed entirely.
   */
  revokeCapabilities(origin: string, capabilities: readonly FluidCapability[]): FluidPermission | null {
    const permission = this.get(origin);
    if (!permission) return null;

    const remaining = permission.capabilities.filter(
      (capability) => !capabilities.includes(capability),
    );
    if (remaining.length === 0) {
      this.#byOrigin.delete(origin);
      return null;
    }

    const updated: FluidPermission = { ...permission, capabilities: remaining };
    this.#byOrigin.set(origin, updated);
    return updated;
  }

  require(origin: string, capability: FluidCapability): FluidPermission {
    const permission = this.get(origin);
    if (!permission) {
      throw new FluidError(
        FluidErrorCode.Unauthorized,
        `Origin ${origin} has no active permission.`,
      );
    }
    if (!permission.capabilities.includes(capability)) {
      throw new FluidError(
        FluidErrorCode.PermissionDenied,
        `Capability "${capability}" was not granted to ${origin}.`,
      );
    }
    return permission;
  }

  /** Enforces the capability declared for a method in the protocol table. */
  checkMethod(method: FluidMethodName, origin: string): FluidPermission {
    const capability = FLUID_METHOD_CAPABILITIES[method];
    if (capability === null) {
      const permission = this.get(origin);
      if (!permission) {
        throw new FluidError(
          FluidErrorCode.Unauthorized,
          `Origin ${origin} has no active permission.`,
        );
      }
      return permission;
    }
    return this.require(origin, capability);
  }
}

/** Active sessions, always bound to the origin that created them. */
export class SessionRegistry {
  readonly #byId = new Map<string, FluidSession>();
  readonly #now: () => number;
  #counter = 0;

  constructor(now: () => number = () => Date.now()) {
    this.#now = now;
  }

  create(origin: string, params: FluidCreateSessionParams = {}): FluidSession {
    this.#counter += 1;
    const createdAt = this.#now();
    const session: FluidSession = {
      id: `session_${this.#counter}`,
      origin,
      appId: params.metadata?.appId,
      model: params.model,
      status: "active",
      createdAt,
      expiresAt: createdAt + DEFAULT_SESSION_TTL_MS,
    };

    this.#byId.set(session.id, session);
    return session;
  }

  get(id: string): FluidSession {
    const session = this.#byId.get(id);
    if (!session) throw new FluidError(FluidErrorCode.SessionNotFound, "Unknown session.");

    if (session.status === "active" && session.expiresAt !== undefined && session.expiresAt <= this.#now()) {
      session.status = "expired";
    }
    if (session.status !== "active") {
      throw new FluidError(FluidErrorCode.SessionExpired, "Session is no longer active.");
    }
    return session;
  }

  /** Session ids are guessable, so the caller's origin is always verified. */
  requireOwned(id: string, origin: string): FluidSession {
    const session = this.get(id);
    if (session.origin !== origin) {
      throw new FluidError(
        FluidErrorCode.PermissionDenied,
        "The session belongs to a different origin.",
      );
    }
    return session;
  }

  /**
   * Rehydrates a session after the service worker was suspended.
   *
   * Sessions are persisted because MV3 workers are killed between requests; a
   * page that created a session before the restart must keep working.
   */
  restore(session: FluidSession): void {
    if (this.#byId.has(session.id)) return;
    this.#byId.set(session.id, { ...session });
  }

  close(id: string): void {
    const session = this.#byId.get(id);
    if (session) session.status = "closed";
  }

  closeForOrigin(origin: string): number {
    let closed = 0;
    for (const session of this.#byId.values()) {
      if (session.origin === origin && session.status === "active") {
        session.status = "closed";
        closed += 1;
      }
    }
    return closed;
  }
}

/** Sliding-window limiter used before any provider call is made. */
export class RateLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #hits = new Map<string, number[]>();
  readonly #now: () => number;

  constructor(limit = 60, windowMs = 60_000, now: () => number = () => Date.now()) {
    this.#limit = limit;
    this.#windowMs = windowMs;
    this.#now = now;
  }

  consume(key: string): void {
    const now = this.#now();
    const windowStart = now - this.#windowMs;
    const recent = (this.#hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

    if (recent.length >= this.#limit) {
      throw new FluidError(
        FluidErrorCode.RateLimited,
        `Rate limit of ${this.#limit} requests per ${this.#windowMs}ms exceeded.`,
        { retryAfterMs: recent[0] === undefined ? this.#windowMs : recent[0] + this.#windowMs - now },
      );
    }

    recent.push(now);
    this.#hits.set(key, recent);
  }
}

/** Requests per origin per day when the user has not chosen a number. */
export const DEFAULT_DAILY_REQUESTS = 300;

/** Storage the ledger writes through, so the runtime stays free of IndexedDB. */
export interface BudgetStore {
  read(day: string, origin: string): Promise<{ requests: number } | undefined>;
  write(day: string, origin: string, value: { requests: number }): Promise<void>;
}

export interface BudgetSnapshot {
  used: number;
  limit: number;
  day: string;
  resetsAt: number;
}

/**
 * Daily request budget per origin.
 *
 * A Web3 wallet does not need this — the chain refuses a transaction the
 * account cannot pay for. Here the balance lives with the provider, so nothing
 * outside the wallet stops a page from asking ten thousand times: a retry loop
 * or a prompt-injected app burns the user's credit silently. `limit = 0` means
 * unlimited, which is an explicit choice rather than a default.
 */
export class RequestBudget {
  readonly #store: BudgetStore;
  readonly #now: () => number;

  constructor(store: BudgetStore, now: () => number = () => Date.now()) {
    this.#store = store;
    this.#now = now;
  }

  static dayKey(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
  }

  static resetsAt(now: number): number {
    const date = new Date(now);
    date.setUTCHours(24, 0, 0, 0);
    return date.getTime();
  }

  /** Today's counter, without spending anything. */
  async usage(origin: string, limit = 0): Promise<BudgetSnapshot> {
    return this.#snapshot(origin, limit);
  }

  /**
   * Counts one request against today's budget.
   *
   * Throws `BudgetExceeded` before the provider is called, so the refusal costs
   * the user nothing.
   */
  async consume(origin: string, limit: number): Promise<BudgetSnapshot> {
    const snapshot = await this.#snapshot(origin, limit);
    if (limit > 0 && snapshot.used >= limit) {
      throw new FluidError(
        FluidErrorCode.BudgetExceeded,
        `${origin} has used its ${limit} requests for ${snapshot.day}. It resets at ${new Date(snapshot.resetsAt).toISOString()}.`,
        snapshot,
      );
    }

    await this.#store.write(snapshot.day, origin, { requests: snapshot.used + 1 });
    return { ...snapshot, used: snapshot.used + 1 };
  }

  async #snapshot(origin: string, limit: number): Promise<BudgetSnapshot> {
    const now = this.#now();
    const day = RequestBudget.dayKey(now);
    const record = await this.#store.read(day, origin);
    return {
      used: record?.requests ?? 0,
      limit,
      day,
      resetsAt: RequestBudget.resetsAt(now),
    };
  }
}
