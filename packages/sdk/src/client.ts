import {
  FLUID_EVENTS,
  FLUID_LIMITS,
  FluidError,
  FluidErrorCode,
  FluidMethod,
  isPermissionExpired,
  messageToText,
  toFluidError,
  type FluidCapability,
  type FluidConversation,
  type FluidConversationDetail,
  type FluidCreateSessionParams,
  type FluidInferenceDeltaPayload,
  type FluidInferenceErrorPayload,
  type FluidInferenceParams,
  type FluidInferenceResult,
  type FluidInferenceStartPayload,
  type FluidMessage,
  type FluidMethodName,
  type FluidModel,
  type FluidPage,
  type FluidParamsOf,
  type FluidPermission,
  type FluidPermissionRequest,
  type FluidPermissionsChangedPayload,
  type FluidProvider,
  type FluidResultOf,
  type FluidSession,
  type FluidQuota,
  type FluidWalletInfo,
  type FluidBridgeDiagnostics,
  type FluidEvent,
  type FluidFinishReason,
} from "@fluid-wallet/protocol";

import { createEventQueue, type EventQueue } from "./stream";
import {
  createRequestId,
  createTransport,
  type FluidRequestOptions,
  type FluidTransport,
} from "./transport";

/** Capabilities a page gets when it calls `connect()` without an explicit list. */
export const DEFAULT_CONNECT_CAPABILITIES = [
  "wallet:read",
  "models:list",
  "inference:text",
  "inference:stream",
] as const satisfies readonly FluidCapability[];

/** How long `detect()` waits before concluding no wallet is listening. */
const DETECT_TIMEOUT_MS = 2_000;

/**
 * The second budget, spent only when a bridge proved the extension is there.
 * It covers a service worker that has to be booted from scratch; see `detect`.
 */
const DETECT_COLD_START_MS = 10_000;

/**
 * One `wallet.getInfo` attempt, kept so a failure can be explained later.
 *
 * "Nothing answered" is the least useful thing a wallet can say, and it is
 * almost always the sum of several attempts: a 2s probe, a retry, and whatever
 * the page-side pipe was doing meanwhile. Recording each attempt turns the
 * post-mortem into arithmetic instead of guesswork.
 */
export interface FluidDetectAttempt {
  budgetMs: number;
  elapsedMs: number;
  /** `answered`, `timeout`, or the wire code that came back. */
  outcome: string;
  message?: string;
}

export type FluidAvailability = "unknown" | "available" | "unavailable";
export type FluidConnectionStatus = "disconnected" | "connecting" | "connected";
export type FluidAuthorizationStatus = "unknown" | "granted" | "denied" | "expired";

export interface FluidInferenceState {
  id: string;
  sessionId: string;
  model: string;
  status: "streaming" | "done" | "error" | "cancelled";
  text: string;
  finishReason?: FluidFinishReason;
}

/**
 * Connection, authorization, session and inference state are tracked
 * separately on purpose: collapsing them into one boolean is how apps end up
 * showing "connected" while every call fails.
 */
export interface FluidClientState {
  availability: FluidAvailability;
  connection: FluidConnectionStatus;
  authorization: FluidAuthorizationStatus;
  wallet: FluidWalletInfo | null;
  permission: FluidPermission | null;
  session: FluidSession | null;
  inference: Readonly<Record<string, FluidInferenceState>>;
  lastError: FluidError | null;
}

export interface FluidInferenceHandle {
  requestId: string;
  events: AsyncIterable<FluidEvent>;
  completed: Promise<FluidInferenceResult>;
  cancel(): Promise<void>;
}

export interface FluidClientOptions {
  transport?: FluidTransport;
  appId?: string;
  appName?: string;
  timeoutMs?: number;
}

function initialState(): FluidClientState {
  return {
    availability: "unknown",
    connection: "disconnected",
    authorization: "unknown",
    wallet: null,
    permission: null,
    session: null,
    inference: {},
    lastError: null,
  };
}

export class FluidClient {
  readonly #transport: FluidTransport;
  readonly #options: FluidClientOptions;
  readonly #listeners = new Set<(state: FluidClientState) => void>();
  readonly #queues = new Map<string, EventQueue<FluidEvent>>();
  readonly #detachEvents: () => void;

  #state: FluidClientState = initialState();
  #detectAttempts: FluidDetectAttempt[] = [];
  #disposed = false;

  constructor(options: FluidClientOptions = {}) {
    this.#options = options;
    this.#transport = options.transport ?? createTransport(options.timeoutMs);
    this.#detachEvents = this.#transport.onEvent((event) => this.#handleEvent(event));
  }

  get state(): FluidClientState {
    return this.#state;
  }

  /** True once `dispose()` ran. A disposed client cannot be revived. */
  get disposed(): boolean {
    return this.#disposed;
  }

  get transportKind(): FluidTransport["kind"] {
    return this.#transport.kind;
  }

  /**
   * What the page-side script says about its own pipe, when it can say anything.
   *
   * A missing bridge is not the same as a bridge whose relay is gone: the first
   * means nothing was injected, the second means the extension is loaded but
   * the tab predates its last reload.
   */
  get diagnostics(): FluidBridgeDiagnostics | undefined {
    return this.#transport.diagnostics?.();
  }

  subscribe(listener: (state: FluidClientState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Typed escape hatch for methods the SDK does not wrap yet. */
  call<M extends FluidMethodName>(
    method: M,
    params?: FluidParamsOf<M>,
    options?: FluidRequestOptions,
  ): Promise<FluidResultOf<M>> {
    return this.#call<FluidResultOf<M>>(method, params, options);
  }

  /**
   * Subscribes to every protocol event.
   *
   * `createFetch` owns a long-lived request and needs the raw event stream with
   * its own request id, not the aggregated state the hooks use.
   */
  onEvent(handler: (event: FluidEvent) => void): () => void {
    return this.#transport.onEvent(handler);
  }

  /**
   * Checks whether a wallet answers at all.
   *
   * Uses a short deadline: with no extension installed nobody replies, so the
   * full 60s request timeout would be a terrible first-run experience.
   *
   * A short deadline alone is wrong, though, because an MV3 background worker
   * is disposable: Chrome stops it after roughly 30 seconds of idleness, so the
   * first message a page sends after a pause has to boot one from scratch —
   * evaluate the bundle, open IndexedDB, restore grants. On a cold disk that
   * takes seconds, and the wallet is not missing, it is starting. When a bridge
   * exists the extension is definitely installed, so a timeout gets one more,
   * longer attempt instead of being reported as "no wallet": a false negative
   * here is what sends people off to reinstall a wallet that already works.
   */
  async detect(): Promise<FluidWalletInfo | null> {
    const budgets =
      this.#transport.kind === "bridge"
        ? [DETECT_TIMEOUT_MS, DETECT_COLD_START_MS]
        : [DETECT_TIMEOUT_MS];

    this.#detectAttempts = [];

    for (const timeoutMs of budgets) {
      const startedAt = Date.now();
      try {
        const info = await this.#call<FluidWalletInfo>(FluidMethod.WalletGetInfo, undefined, {
          timeoutMs,
        });
        this.#recordAttempt({
          budgetMs: timeoutMs,
          elapsedMs: Date.now() - startedAt,
          outcome: "answered",
        });
        this.#patch({ availability: "available", wallet: info });
        return info;
      } catch (error) {
        const elapsedMs = Date.now() - startedAt;
        const code = FluidError.is(error) ? error.code : undefined;
        this.#recordAttempt({
          budgetMs: timeoutMs,
          elapsedMs,
          outcome:
            code === FluidErrorCode.Timeout
              ? "timeout"
              : code === FluidErrorCode.NotInstalled
                ? "not-installed"
                : `error ${code ?? "unknown"}`,
          ...(error instanceof Error ? { message: error.message } : {}),
        });
        if (
          !FluidError.is(error, FluidErrorCode.Timeout) &&
          !FluidError.is(error, FluidErrorCode.NotInstalled)
        ) {
          this.#patch({ availability: "unavailable", wallet: null });
          throw toFluidError(error);
        }
      }
    }

    this.#patch({ availability: "unavailable", wallet: null });
    return null;
  }

  /**
   * What the last `detect()` actually did, attempt by attempt.
   *
   * A caller that is about to tell someone "the wallet is not answering" owes
   * them this much: which calls went out, how long each waited, and what came
   * back.
   */
  get detectAttempts(): readonly FluidDetectAttempt[] {
    return this.#detectAttempts;
  }

  #recordAttempt(attempt: FluidDetectAttempt): void {
    this.#detectAttempts = [...this.#detectAttempts, attempt];
    const suffix = attempt.message ? `: ${attempt.message}` : "";
    console.debug(
      `[fluid-wallet] wallet.getInfo ${attempt.outcome} after ${attempt.elapsedMs}ms (budget ${attempt.budgetMs}ms)${suffix}`,
    );
  }

  async connect(request?: Partial<FluidPermissionRequest>): Promise<FluidPermission> {
    const params: FluidPermissionRequest = {
      appId: this.#options.appId,
      appName: this.#options.appName,
      capabilities: [...DEFAULT_CONNECT_CAPABILITIES],
      ...request,
    };

    this.#patch({ connection: "connecting" });

    try {
      const permission = await this.#call<FluidPermission>(FluidMethod.WalletConnect, params);
      this.#patch({
        connection: "connected",
        authorization: isPermissionExpired(permission) ? "expired" : "granted",
        permission,
      });
      return permission;
    } catch (error) {
      const fluidError = toFluidError(error);
      // Only an actual refusal is a denial.
      //
      // This used to write `denied` unconditionally, so a page whose wallet was
      // missing, asleep or broken told the user they had refused access — for a
      // prompt that never appeared. Somebody then goes looking for a decision
      // nobody made, while the real problem is that nothing answered at all.
      if (
        fluidError.code === FluidErrorCode.Rejected ||
        fluidError.code === FluidErrorCode.PermissionDenied
      ) {
        this.#patch({ connection: "disconnected", authorization: "denied" });
      } else {
        this.#patch({ connection: "disconnected" });
      }
      throw fluidError;
    }
  }

  async disconnect(): Promise<void> {
    try {
      await this.#call(FluidMethod.WalletDisconnect);
    } finally {
      this.#patch({
        connection: "disconnected",
        authorization: "unknown",
        permission: null,
        session: null,
      });
    }
  }

  async getPermissions(): Promise<FluidPermission | null> {
    const permission = await this.#call<FluidPermission | null>(FluidMethod.WalletGetPermissions);
    this.#patch({
      permission,
      authorization: permission
        ? isPermissionExpired(permission)
          ? "expired"
          : "granted"
        : "unknown",
    });
    return permission;
  }

  async revoke(capabilities?: FluidCapability[]): Promise<boolean> {
    const result = await this.#call<{ revoked: boolean }>(
      FluidMethod.WalletRevoke,
      capabilities ? { capabilities } : undefined,
    );
    this.#patch({ permission: null, authorization: "denied", session: null });
    return result.revoked;
  }

  async listProviders(): Promise<FluidProvider[]> {
    return this.#call<FluidProvider[]>(FluidMethod.ProviderList);
  }

  async listModels(providerId?: string): Promise<FluidModel[]> {
    return this.#call<FluidModel[]>(FluidMethod.ModelList, providerId ? { providerId } : undefined);
  }

  /**
   * Today's request budget for this origin.
   *
   * This is the one piece of wallet state a chat UI needs in order to warn
   * before a stream dies, rather than after. Returns `null` against a wallet
   * that predates `usage.get`: hiding a counter is better than failing to boot.
   */
  async usage(): Promise<FluidQuota | null> {
    try {
      return await this.#call<FluidQuota>(FluidMethod.UsageGet);
    } catch (error) {
      if (FluidError.is(error, FluidErrorCode.MethodNotFound)) return null;
      throw toFluidError(error);
    }
  }

  async createSession(params: FluidCreateSessionParams = {}): Promise<FluidSession> {
    const session = await this.#call<FluidSession>(FluidMethod.SessionCreate, params);
    this.#patch({ session });
    return session;
  }

  async closeSession(sessionId?: string): Promise<void> {
    const target = sessionId ?? this.#state.session?.id;
    if (!target) throw new FluidError(FluidErrorCode.SessionNotFound, "No active session.");

    await this.#call(FluidMethod.SessionClose, { sessionId: target });
    if (this.#state.session?.id === target) this.#patch({ session: null });
  }

  /**
   * Starts an inference request and returns a handle immediately.
   *
   * Events are correlated by the request id, which is generated before the
   * request is sent so no early delta can be missed.
   */
  createInference(params: FluidInferenceParams): FluidInferenceHandle {
    const requestId = createRequestId();
    const queue = createEventQueue<FluidEvent>({
      // A consumer that breaks out of `for await` stopped listening; leaving
      // the generation running bills the user for tokens nobody will read.
      onCancel: () => {
        void this.cancelInference(params.sessionId, requestId).catch(() => undefined);
      },
    });

    this.#queues.set(requestId, queue);
    this.#patch({
      inference: {
        ...this.#state.inference,
        [requestId]: {
          id: requestId,
          sessionId: params.sessionId,
          model: params.model ?? this.#state.session?.model ?? "unknown",
          status: "streaming",
          text: "",
        },
      },
    });

    const completed = this.#runInference(requestId, params, queue);

    return {
      requestId,
      events: queue.iterable,
      completed,
      cancel: () => this.cancelInference(params.sessionId, requestId),
    };
  }

  async cancelInference(sessionId: string, inferenceId: string): Promise<void> {
    await this.#call(FluidMethod.InferenceCancel, { sessionId, inferenceId });
  }

  async listConversations(params?: {
    limit?: number;
    cursor?: string;
  }): Promise<FluidPage<FluidConversation>> {
    return this.#call<FluidPage<FluidConversation>>(FluidMethod.ConversationList, params);
  }

  async getConversation(conversationId: string): Promise<FluidConversationDetail> {
    return this.#call<FluidConversationDetail>(FluidMethod.ConversationGet, { conversationId });
  }

  async appendConversation(conversationId: string, messages: FluidMessage[]): Promise<void> {
    await this.#call(FluidMethod.ConversationAppend, { conversationId, messages });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#detachEvents();
    this.#transport.dispose();
    this.#listeners.clear();
    this.#queues.clear();
  }

  async #call<TResult>(
    method: FluidMethodName,
    params?: unknown,
    options: FluidRequestOptions = {},
  ): Promise<TResult> {
    if (this.#disposed) {
      // A used-after-dispose call is a bug in the caller, not a missing wallet.
      // Reporting it as `NotInstalled` sent one page hunting for a browser
      // extension while its actual problem was a client thrown away by a
      // re-mounted effect.
      throw new FluidError(
        FluidErrorCode.InternalError,
        "This Fluid client has been disposed; create a new one instead of reusing it.",
      );
    }

    try {
      return await this.#transport.request<TResult>(method, params, {
        timeoutMs: this.#options.timeoutMs,
        ...options,
      });
    } catch (error) {
      const fluidError = toFluidError(error);
      this.#patch({ lastError: fluidError });
      throw fluidError;
    }
  }

  async #runInference(
    requestId: string,
    params: FluidInferenceParams,
    queue: EventQueue<FluidEvent>,
  ): Promise<FluidInferenceResult> {
    try {
      const result = await this.#call<FluidInferenceResult>(FluidMethod.InferenceCreate, params, {
        requestId,
        // Generations are long by nature; the per-request default would abort
        // perfectly healthy streams.
        timeoutMs: FLUID_LIMITS.inferenceTimeoutMs,
      });
      this.#updateInference(requestId, {
        status: "done",
        text: messageToText(result.message) || this.#state.inference[requestId]?.text || "",
        finishReason: result.finishReason,
      });
      queue.close();
      return result;
    } catch (error) {
      // A failed request leaves the entry at "streaming" unless it is told
      // otherwise, and a "streaming" entry is never reclaimed.
      this.#updateInference(requestId, { status: "error" });
      queue.fail(error);
      throw error;
    } finally {
      this.#queues.delete(requestId);
      this.#pruneInference(requestId);
    }
  }

  /**
   * Drops finished inferences other than `keep`.
   *
   * Each entry holds its full accumulated text, and nothing ever removed one:
   * a fifty-turn conversation kept fifty transcripts around for as long as the
   * page lived. The one just produced stays, because a UI reads it after
   * `completed` resolves; everything else that is no longer streaming goes.
   */
  #pruneInference(keep: string): void {
    const stale = Object.entries(this.#state.inference).filter(
      ([id, entry]) => id !== keep && entry.status !== "streaming",
    );
    if (stale.length === 0) return;

    const next = { ...this.#state.inference };
    for (const [id] of stale) delete next[id];
    this.#patch({ inference: next });
  }

  #updateInference(requestId: string, patch: Partial<FluidInferenceState>): void {
    const current = this.#state.inference[requestId];
    if (!current) return;
    this.#patch({
      inference: { ...this.#state.inference, [requestId]: { ...current, ...patch } },
    });
  }

  #handleEvent(event: FluidEvent): void {
    if (event.requestId) this.#queues.get(event.requestId)?.push(event);
    const requestId = event.requestId;

    switch (event.type) {
      case FLUID_EVENTS.InferenceStart: {
        if (!requestId) return;
        const payload = event.payload as FluidInferenceStartPayload;
        this.#updateInference(requestId, { model: payload.model, status: "streaming" });
        return;
      }

      case FLUID_EVENTS.InferenceDelta: {
        if (!requestId) return;
        const payload = event.payload as FluidInferenceDeltaPayload;
        const current = this.#state.inference[requestId];
        this.#updateInference(requestId, { text: (current?.text ?? "") + payload.text });
        return;
      }

      case FLUID_EVENTS.InferenceToolCall: {
        // Tool execution stays in the app; the SDK only surfaces the call so the
        // app can run it and send the result back with the next turn.
        return;
      }

      case FLUID_EVENTS.InferenceDone: {
        if (!requestId) return;
        const payload = event.payload as FluidInferenceResult;
        this.#updateInference(requestId, {
          status: "done",
          finishReason: payload.finishReason,
          text: messageToText(payload.message) || this.#state.inference[requestId]?.text || "",
        });
        this.#queues.get(requestId)?.close();
        return;
      }

      case FLUID_EVENTS.InferenceError: {
        if (!requestId) return;
        const payload = event.payload as FluidInferenceErrorPayload;
        this.#updateInference(requestId, { status: "error" });
        this.#patch({ lastError: FluidError.from(payload.error) });
        this.#queues.get(requestId)?.close();
        return;
      }

      case FLUID_EVENTS.InferenceCancelled: {
        if (!requestId) return;
        this.#updateInference(requestId, { status: "cancelled", finishReason: "cancelled" });
        this.#queues.get(requestId)?.close();
        return;
      }

      case FLUID_EVENTS.PermissionsChanged: {
        const payload = event.payload as FluidPermissionsChangedPayload;
        this.#patch({
          permission: payload.permission,
          authorization: payload.permission ? "granted" : "denied",
        });
        return;
      }

      case FLUID_EVENTS.WalletDisconnected: {
        this.#patch({
          connection: "disconnected",
          permission: null,
          session: null,
          authorization: "unknown",
        });
        return;
      }

      default:
        return;
    }
  }

  #patch(patch: Partial<FluidClientState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener(this.#state);
  }
}
