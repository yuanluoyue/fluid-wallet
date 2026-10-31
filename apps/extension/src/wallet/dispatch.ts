import {
  FLUID_EVENTS,
  FluidError,
  FluidErrorCode,
  FluidMethod,
  PROTOCOL_VERSION,
  assertInferenceParams,
  assertProxyParams,
  type FluidCapability,
  type FluidConversation,
  type FluidConversationDetail,
  type FluidCreateSessionParams,
  type FluidErrorShape,
  type FluidInferenceResult,
  type FluidMessage,
  type FluidPermission,
  type FluidPermissionRequest,
  type FluidProvider,
  type FluidRequest,
  type FluidResponse,
  type FluidSession,
  type FluidWalletInfo,
} from "@fluid-wallet/protocol";
import { PermissionStore, RateLimiter, SessionRegistry } from "@fluid-wallet/core";

import { openSetupWindow, requestApproval } from "./approval";
import { spendRequest, usageToday } from "./budget";
import { db } from "./db";
import { emit, rememberTab } from "./events";
import { cancelInference, runInference } from "./inference";
import { listModels, listProviders } from "./providers";
import { cancelProxy, runProxy } from "./proxy";
import { hasVault, isUnlocked } from "./vault";

const WALLET_VERSION = "0.1.0";

/** 60 generations per minute per origin: enough for a chat UI, not for a scraper. */
const REQUESTS_PER_MINUTE = 60;

const permissions = new PermissionStore();
const sessions = new SessionRegistry();
const limiter = new RateLimiter(REQUESTS_PER_MINUTE, 60_000);

let hydrated = false;

/**
 * Loads persisted grants into memory.
 *
 * Runs once per service worker instance; the worker is disposable, so any
 * request may be the first one after a restart.
 */
async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  for (const connection of await db().connections.toArray()) {
    permissions.restore(connection.permission);
  }
}

export async function grantPermission(
  origin: string,
  permission: FluidPermission,
): Promise<void> {
  permissions.restore(permission);
  const now = Date.now();
  await db().connections.put({
    origin,
    appId: permission.appId,
    permission,
    createdAt: now,
    updatedAt: now,
  });
}

export async function revokePermission(
  origin: string,
  capabilities?: FluidCapability[],
): Promise<FluidPermission | null> {
  if (capabilities?.length) {
    const updated = permissions.revokeCapabilities(origin, capabilities);
    if (updated) {
      await db().connections.update(origin, { permission: updated, updatedAt: Date.now() });
    } else {
      await db().connections.delete(origin);
      sessions.closeForOrigin(origin);
    }
    return updated;
  }

  permissions.revoke(origin);
  sessions.closeForOrigin(origin);
  await db().connections.delete(origin);
  return null;
}

function ok<T>(id: string, result: T): FluidResponse<T> {
  return { jsonrpc: "2.0", id, result };
}

function toErrorShape(error: unknown): FluidErrorShape {
  if (error instanceof FluidError) return error.toJSON();
  return {
    code: FluidErrorCode.InternalError,
    message: error instanceof Error ? error.message : "Unexpected wallet error.",
  };
}

async function describeWallet(): Promise<FluidWalletInfo> {
  return {
    name: "Fluid Wallet",
    walletVersion: WALLET_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: [
      "wallet:read",
      "models:list",
      "inference:text",
      "inference:stream",
      "inference:tools",
      "inference:proxy",
      "conversation:read",
      "conversation:write",
      "activity:read",
    ],
    locked: !(await isUnlocked()),
  };
}

/**
 * Single entry point for every page request.
 *
 * Origin verification and capability checks happen here and nowhere else: the
 * page-side SDK is a convenience layer, never a security boundary.
 */
export async function dispatch(
  request: FluidRequest,
  origin: string | null,
  tabId?: number,
): Promise<FluidResponse> {
  try {
    if (!origin) {
      throw new FluidError(
        FluidErrorCode.OriginMismatch,
        "Unable to verify the sender origin; refusing the request.",
      );
    }

    await hydrate();
    if (tabId !== undefined) rememberTab(request.id, tabId);

    switch (request.method) {
      case FluidMethod.WalletGetInfo:
        return ok(request.id, await describeWallet());

      case FluidMethod.WalletConnect:
        return ok(request.id, await connect(request.id, origin, request.params));

      case FluidMethod.WalletDisconnect: {
        sessions.closeForOrigin(origin);
        await emit(request.id, { type: FLUID_EVENTS.WalletDisconnected, payload: {} });
        return ok(request.id, { ok: true });
      }

      case FluidMethod.WalletGetPermissions:
        permissions.checkMethod(FluidMethod.WalletGetPermissions, origin);
        return ok(request.id, permissions.get(origin));

      case FluidMethod.WalletRevoke: {
        permissions.checkMethod(FluidMethod.WalletRevoke, origin);
        const params = request.params as { capabilities?: FluidCapability[] } | undefined;
        const updated = await revokePermission(origin, params?.capabilities);
        await emit(request.id, {
          type: FLUID_EVENTS.PermissionsChanged,
          requestId: request.id,
          payload: { permission: updated },
        });
        return ok(request.id, { revoked: updated === null });
      }

      case FluidMethod.ProviderList: {
        const permission = permissions.checkMethod(FluidMethod.ProviderList, origin);
        const providers = await visibleProviders(permission);
        return ok(request.id, providers);
      }

      case FluidMethod.ModelList: {
        const permission = permissions.checkMethod(FluidMethod.ModelList, origin);
        const params = request.params as { providerId?: string } | undefined;
        const ids = params?.providerId
          ? [params.providerId].filter((id) => allowedProvider(permission, id))
          : permission.providers;
        return ok(request.id, await listModels(ids));
      }

      case FluidMethod.SessionCreate: {
        const permission = permissions.checkMethod(FluidMethod.SessionCreate, origin);
        const params = (request.params ?? {}) as FluidCreateSessionParams;
        if (params.model && !allowedModel(permission, params.model)) {
          throw new FluidError(
            FluidErrorCode.ModelNotAllowed,
            `Model "${params.model}" was not granted to this connection.`,
          );
        }
        const session = sessions.create(origin, params);
        await db().sessions.put({
          id: session.id,
          origin,
          appId: session.appId,
          model: session.model,
          status: "active",
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        });
        return ok(request.id, session);
      }

      case FluidMethod.SessionClose: {
        permissions.checkMethod(FluidMethod.SessionClose, origin);
        const { sessionId } = request.params as { sessionId: string };
        const session = await ensureSession(sessionId, origin);
        sessions.close(session.id);
        await db().sessions.update(session.id, { status: "closed" });
        return ok(request.id, { ok: true });
      }

      case FluidMethod.InferenceCreate: {
        const permission = permissions.checkMethod(FluidMethod.InferenceCreate, origin);
        const params = assertInferenceParams(request.params);
        const session = await ensureSession(params.sessionId, origin);
        if (!allowedModel(permission, params.model ?? session.model)) {
          throw new FluidError(
            FluidErrorCode.ModelNotAllowed,
            "The requested model was not granted to this connection.",
          );
        }
        if (!(await hasVault())) {
          throw new FluidError(
            FluidErrorCode.Locked,
            "Set up the wallet and add a provider before calling models.",
          );
        }
        limiter.consume(origin);
        await spendRequest(origin);

        const result: FluidInferenceResult = await runInference({
          requestId: request.id,
          origin,
          permission,
          session,
          params,
        });
        return ok(request.id, result);
      }

      case FluidMethod.InferenceCancel: {
        permissions.checkMethod(FluidMethod.InferenceCancel, origin);
        const { sessionId, inferenceId } = request.params as {
          sessionId: string;
          inferenceId: string;
        };
        await ensureSession(sessionId, origin);
        return ok(request.id, {
          cancelled: cancelInference(inferenceId) || cancelProxy(inferenceId),
        });
      }

      case FluidMethod.InferenceProxy: {
        const permission = permissions.checkMethod(FluidMethod.InferenceProxy, origin);
        const params = assertProxyParams(request.params);
        const session = await ensureSession(params.sessionId, origin);
        if (!(await hasVault())) {
          throw new FluidError(
            FluidErrorCode.Locked,
            "Set up the wallet and add a provider before calling models.",
          );
        }
        limiter.consume(origin);
        await spendRequest(origin);

        const result = await runProxy({
          requestId: request.id,
          origin,
          permission,
          session,
          params,
        });
        return ok(request.id, result);
      }

      case FluidMethod.ConversationList: {
        permissions.checkMethod(FluidMethod.ConversationList, origin);
        const params = (request.params ?? {}) as { limit?: number; cursor?: string };
        return ok(request.id, await listConversations(origin, params));
      }

      case FluidMethod.ConversationGet: {
        permissions.checkMethod(FluidMethod.ConversationGet, origin);
        const { conversationId } = request.params as { conversationId: string };
        return ok(request.id, await getConversation(conversationId, origin));
      }

      case FluidMethod.ConversationAppend: {
        permissions.checkMethod(FluidMethod.ConversationAppend, origin);
        const { conversationId, messages } = request.params as {
          conversationId: string;
          messages: FluidMessage[];
        };
        await appendConversation(conversationId, origin, messages);
        return ok(request.id, { ok: true });
      }

      case FluidMethod.UsageGet: {
        permissions.checkMethod(FluidMethod.UsageGet, origin);
        return ok(request.id, await usageToday(origin));
      }

      case FluidMethod.ActivityList: {
        permissions.checkMethod(FluidMethod.ActivityList, origin);
        const params = (request.params ?? {}) as { limit?: number; cursor?: string };
        const limit = clampLimit(params.limit);
        const logs = await db().inferenceLogs.orderBy("startedAt").reverse().toArray();
        const mine = logs.filter((log) => log.origin === origin);
        const start = params.cursor ? Number(params.cursor) : 0;
        const page = mine.slice(start, start + limit);
        return ok(request.id, {
          items: page.map((log) => ({
            id: log.id,
            origin: log.origin,
            appId: log.appId,
            providerId: log.providerId,
            model: log.model,
            status: log.status,
            startedAt: log.startedAt,
            finishedAt: log.finishedAt,
            durationMs: log.durationMs,
            errorCode: log.errorCode,
          })),
          ...(mine.length > start + limit ? { cursor: String(start + limit) } : {}),
        });
      }

      default:
        throw new FluidError(
          FluidErrorCode.MethodNotFound,
          `Method "${request.method}" is not implemented in this build.`,
        );
    }
  } catch (error) {
    return { jsonrpc: "2.0", id: request.id, error: toErrorShape(error) };
  }
}

async function connect(
  requestId: string,
  origin: string,
  rawParams: unknown,
): Promise<FluidPermission> {
  const params = (rawParams ?? { capabilities: [] }) as FluidPermissionRequest;
  const requested: FluidPermissionRequest = {
    ...params,
    capabilities: params.capabilities ?? [],
  };
  if (requested.capabilities.length === 0) {
    throw new FluidError(
      FluidErrorCode.InvalidParams,
      "wallet.connect needs at least one capability.",
    );
  }

  const existing = permissions.get(origin);
  if (existing && requested.capabilities.every((c) => existing.capabilities.includes(c))) {
    return existing;
  }

  // Approving a connection the wallet cannot serve would only fail one step
  // later, with the user left staring at a chat box.
  if (!(await hasVault())) {
    throw new FluidError(
      FluidErrorCode.Locked,
      "Fluid Wallet has not been set up yet. Open the extension to create it.",
    );
  }

  // The approval window is the only place the user sees what a grant reaches,
  // so it is told up front instead of making them guess from a capability list.
  const walletProviders = await listProviders();

  // A grant to a wallet with no provider reaches nothing. Refusing here is the
  // difference between "connect failed, and here is the screen to fix it" and
  // an approved connection whose first chat message dies for no stated reason.
  if (walletProviders.length === 0) {
    await openSetupWindow(origin);
    throw new FluidError(
      FluidErrorCode.ProviderUnavailable,
      "Fluid Wallet has no provider yet. Add one in the wallet, then connect again.",
      { reason: "no-provider" },
    );
  }

  const scoped = requested.providers?.length
    ? walletProviders.filter((provider) => requested.providers?.includes(provider.id))
    : walletProviders;

  const decision = await requestApproval(origin, requested, {
    firstConnection: existing === null,
    providerNames: scoped.map((provider) => provider.name),
    defaultModel: scoped[0]?.defaultModel,
    nameMismatch: looksImpersonating(requested.appName, origin),
  });
  if (decision === "deny") {
    throw new FluidError(FluidErrorCode.Rejected, "The user denied the connection request.");
  }

  const merged: FluidPermissionRequest = existing
    ? {
        ...requested,
        capabilities: [...new Set([...existing.capabilities, ...requested.capabilities])],
        providers: requested.providers?.length ? requested.providers : existing.providers,
      }
    : requested;

  const permission = permissions.grant(origin, merged, {
    // `null` means "until revoked" — the opposite of what the old code did, which
    // handed "always allow" a 30-day expiry and "allow" none at all.
    ttlMs: decision === "always" ? null : undefined,
  });

  await grantPermission(origin, permission);
  await emit(requestId, {
    type: FLUID_EVENTS.PermissionsChanged,
    requestId,
    payload: { permission },
  });
  return permission;
}

/**
 * Whether a self-declared app name points at a domain the origin does not own.
 *
 * Cheap impersonation check: the page says "Uniswap" or "api.deepseek.com" but
 * the browser says it is `unisvvap.app`. Judging that is the user's call, so
 * the wallet only surfaces the discrepancy rather than blocking on it.
 */
function looksImpersonating(appName: string | undefined, origin: string): boolean {
  if (!appName) return false;

  let host: string;
  try {
    host = new URL(origin).host.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }

  const mentioned = appName.toLowerCase().match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+/g);
  if (!mentioned?.length) return false;

  return !mentioned.some(
    (candidate) => candidate === host || host.endsWith(`.${candidate}`) || candidate.endsWith(host),
  );
}

async function visibleProviders(permission: FluidPermission): Promise<FluidProvider[]> {  const providers = await listProviders();
  if (!permission.providers.length) return providers;
  return providers.filter((provider) => permission.providers.includes(provider.id));
}

function allowedProvider(permission: FluidPermission, providerId: string): boolean {
  return permission.providers.length === 0 || permission.providers.includes(providerId);
}

function allowedModel(permission: FluidPermission, model: string | undefined): boolean {
  if (!model) return true;
  if (!permission.models?.length) return true;
  const separator = model.indexOf(":");
  const bare = separator === -1 ? model : model.slice(separator + 1);
  return permission.models.includes(model) || permission.models.includes(bare);
}

/**
 * Returns a live session, rehydrating it from storage if the worker restarted.
 */
async function ensureSession(sessionId: string, origin: string): Promise<FluidSession> {
  try {
    return sessions.requireOwned(sessionId, origin);
  } catch (error) {
    const record = await db().sessions.get(sessionId);
    if (!record || record.origin !== origin) throw error;
    if (record.status !== "active") {
      throw new FluidError(FluidErrorCode.SessionExpired, "Session is no longer active.");
    }

    sessions.restore({
      id: record.id,
      origin: record.origin,
      appId: record.appId,
      model: record.model,
      status: record.status,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    });
    return sessions.requireOwned(sessionId, origin);
  }
}

function clampLimit(value: number | undefined, fallback = 20): number {
  if (!value || value < 1) return fallback;
  return Math.min(value, 100);
}

async function listConversations(
  origin: string,
  params: { limit?: number; cursor?: string },
): Promise<{ items: FluidConversation[]; cursor?: string }> {
  const limit = clampLimit(params.limit);
  const all = await db().conversations.orderBy("updatedAt").reverse().toArray();
  const mine = all.filter((conversation) => conversation.origin === origin);
  const start = params.cursor ? Number(params.cursor) : 0;

  return {
    items: mine.slice(start, start + limit),
    ...(mine.length > start + limit ? { cursor: String(start + limit) } : {}),
  };
}

async function getConversation(
  conversationId: string,
  origin: string,
): Promise<FluidConversationDetail> {
  const conversation = await db().conversations.get(conversationId);
  // Cross-origin reads are reported as "not found" so an app cannot probe for
  // the existence of another app's history.
  if (!conversation || conversation.origin !== origin) {
    throw new FluidError(FluidErrorCode.InvalidParams, "Unknown conversation.");
  }

  const messages = await db().messages.where("conversationId").equals(conversationId).toArray();
  return {
    ...conversation,
    messages: messages
      .sort((left, right) => left.createdAt - right.createdAt)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        toolCalls: message.toolCalls as FluidMessage["toolCalls"],
        createdAt: message.createdAt,
      })),
  };
}

async function appendConversation(
  conversationId: string,
  origin: string,
  messages: FluidMessage[],
): Promise<void> {
  const conversation = await db().conversations.get(conversationId);
  if (!conversation || conversation.origin !== origin) {
    throw new FluidError(FluidErrorCode.InvalidParams, "Unknown conversation.");
  }

  const now = Date.now();
  await db().messages.bulkPut(
    messages.map((message) => ({
      id: message.id ?? crypto.randomUUID(),
      conversationId,
      role: message.role,
      content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
      toolCalls: message.toolCalls,
      createdAt: message.createdAt ?? now,
    })),
  );
  await db().conversations.update(conversationId, {
    messageCount: conversation.messageCount + messages.length,
    updatedAt: now,
  });
}
