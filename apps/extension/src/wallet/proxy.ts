import {
  FLUID_EVENTS,
  FLUID_LIMITS,
  FLUID_PROXY_RESPONSE_HEADER_DENYLIST,
  FluidError,
  FluidErrorCode,
  describeProviderEndpoints,
  isAllowedProviderEndpoint,
  isProxyRequestHeader,
  resolveProviderUrl,
  type FluidEvent,
  type FluidPermission,
  type FluidProxyParams,
  type FluidProxyResponse,
  type FluidSession,
} from "@fluid-wallet/protocol";

import { db } from "./db";
import { emit } from "./events";
import { getProviderCredentials, resolveProviderId } from "./providers";

/** Chunks are coalesced before crossing the message channel, like inference deltas. */
const FLUSH_MS = 40;
const MAX_BATCH_CHARS = 16 * 1024;

const active = new Map<string, AbortController>();

export function cancelProxy(proxyId: string): boolean {
  const controller = active.get(proxyId);
  if (!controller) return false;
  controller.abort();
  return true;
}

export interface RunProxyInput {
  requestId: string;
  origin: string;
  permission: FluidPermission;
  session: FluidSession;
  params: FluidProxyParams;
}

/**
 * Forwards one request to a provider and streams the raw response back.
 *
 * This is the escape hatch that lets a page keep using its provider's own SDK:
 * the wallet contributes the host, the credentials and the origin checks, and
 * otherwise stays out of the way. Unlike `inference.create` it does not parse
 * the provider's format, so it also does not record prompt or response content
 * — only the request line, the status and the byte count.
 *
 * Provider status codes pass through untouched: an `openai` or AI SDK client
 * behind this call must see a real 401/429 so it can raise its own error type.
 */
export async function runProxy(input: RunProxyInput): Promise<FluidProxyResponse> {
  const { requestId, origin, permission, session, params } = input;

  const providerId = await resolveProviderId(params.providerId, permission.providers);
  enforceModelScope(permission, params.body);

  const credentials = await getProviderCredentials(providerId);
  const method = params.method ?? (params.body === undefined ? "GET" : "POST");

  // Fixing the host is only half of it: an origin with `inference:proxy` would
  // otherwise reach every endpoint on the provider, including account and file
  // APIs it was never granted. Checked here, in the trusted runtime, because the
  // page-side SDK is not a boundary.
  if (!isAllowedProviderEndpoint(credentials.baseUrl, params.path, method)) {
    throw new FluidError(
      FluidErrorCode.PermissionDenied,
      `"${method} ${params.path}" is outside the endpoints this wallet proxies. Allowed: ${describeProviderEndpoints()}.`,
    );
  }

  let target: string;
  try {
    target = resolveProviderUrl(credentials.baseUrl, params.path);
  } catch {
    throw new FluidError(FluidErrorCode.InvalidParams, "The provider base URL is not a valid URL.");
  }

  const headers = buildRequestHeaders(params, credentials.apiKey);

  const controller = new AbortController();
  active.set(requestId, controller);

  const startedAt = Date.now();
  let bytes = 0;
  let status = 0;
  let contentType = "application/octet-stream";

  // Serialised emitter: `browser.tabs.sendMessage` is async and out-of-order
  // chunks would corrupt an SSE stream.
  //
  // A failed delivery means the tab navigated away or was closed while the
  // provider was still generating. Nobody is left to read the rest, so the
  // controller is aborted: the alternative is streaming a whole completion
  // into a dead tab and paying for it.
  let chain: Promise<void> = Promise.resolve();
  let undeliverable = false;
  const send = (event: FluidEvent): void => {
    chain = chain
      .then(async () => {
        if (undeliverable) return;
        if (await emit(requestId, event)) return;
        undeliverable = true;
        controller.abort();
      })
      .catch(() => {
        undeliverable = true;
        controller.abort();
      });
  };

  try {
    const response = await fetch(target, {
      method,
      headers,
      ...(params.body === undefined ? {} : { body: params.body }),
      signal: controller.signal,
    });

    status = response.status;
    contentType = response.headers.get("content-type") ?? "application/octet-stream";
    send({
      type: FLUID_EVENTS.ProxyStart,
      requestId,
      payload: {
        proxyId: requestId,
        status,
        contentType,
        ...forwardableHeaders(response.headers),
      },
    });

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let timer: ReturnType<typeof setTimeout> | undefined;

      const flush = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        if (!pending) return;
        const text = pending;
        pending = "";
        send({
          type: FLUID_EVENTS.ProxyChunk,
          requestId,
          payload: { proxyId: requestId, text },
        });
      };

      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          bytes += value.byteLength;
          pending += decoder.decode(value, { stream: true });
          if (pending.length >= MAX_BATCH_CHARS) flush();
          else if (timer === undefined) timer = setTimeout(flush, FLUSH_MS);
        }
        pending += decoder.decode();
      } catch (error) {
        // A cancelled stream is an expected ending, not a provider failure.
        if (!isAbort(error, controller)) throw error;
      } finally {
        flush();
      }
    }

    const truncated = controller.signal.aborted;
    send({
      type: FLUID_EVENTS.ProxyEnd,
      requestId,
      payload: { proxyId: requestId, bytes, ...(truncated ? { truncated } : {}) },
    });
    await chain;

    await writeProxyLog({
      id: requestId,
      origin,
      appId: session.appId,
      providerId,
      label: `raw ${method} ${params.path}`,
      status,
      startedAt,
      truncated,
    });

    return { status, contentType, bytes, ...(truncated ? { truncated } : {}) };
  } catch (error) {
    if (isAbort(error, controller)) {
      send({
        type: FLUID_EVENTS.ProxyEnd,
        requestId,
        payload: { proxyId: requestId, bytes, truncated: true },
      });
      await chain;
      throw new FluidError(
        FluidErrorCode.InferenceCancelled,
        "The provider request was cancelled.",
      );
    }

    const fluidError =
      error instanceof FluidError
        ? error
        : new FluidError(
            FluidErrorCode.ProviderUnavailable,
            error instanceof Error ? error.message : "The provider request failed.",
          );

    send({
      type: FLUID_EVENTS.ProxyError,
      requestId,
      payload: { proxyId: requestId, error: fluidError.toJSON() },
    });
    await chain;

    await writeProxyLog({
      id: requestId,
      origin,
      appId: session.appId,
      providerId,
      label: `raw ${method} ${params.path}`,
      status: 0,
      startedAt,
      errorCode: fluidError.code,
    });

    throw fluidError;
  } finally {
    active.delete(requestId);
  }
}

function isAbort(error: unknown, controller: AbortController): boolean {
  return (
    controller.signal.aborted ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

/**
 * The headers the wallet actually sends upstream.
 *
 * The page may choose the ones in `FLUID_PROXY_REQUEST_HEADERS`: the format and
 * the version, which is exactly what a provider's own SDK negotiates. It cannot
 * choose the credential, and the credential is written last so nothing above it
 * can shadow it — a page that could supply `authorization` could point its own
 * key at the user's account, or blank it out and read the resulting error.
 *
 * Validated again here rather than trusted from the page-side SDK: that SDK is
 * not a boundary, and this function is the one place that decides.
 */
function buildRequestHeaders(params: FluidProxyParams, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(params.headers ?? {})) {
    const key = name.toLowerCase();
    if (!isProxyRequestHeader(key)) continue;
    headers[key] = value;
  }

  if (params.body !== undefined && headers["content-type"] === undefined) {
    headers["content-type"] = "application/json";
  }
  headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

/**
 * The response headers worth handing back to the page.
 *
 * A `Response` that carries only a status and a content type has already thrown
 * away `retry-after`, and with it the client's ability to wait out a rate limit
 * instead of failing the step. The denylist removes what would be wrong by the
 * time it arrives — the body is re-framed as text, so its length and encoding
 * are no longer the provider's — and the caps keep a chatty provider from
 * bloating every message.
 */
function forwardableHeaders(headers: Headers): { headers?: Record<string, string> } {
  const denied = new Set<string>(FLUID_PROXY_RESPONSE_HEADER_DENYLIST);
  const kept: Record<string, string> = {};

  for (const [name, value] of headers) {
    const key = name.toLowerCase();
    if (denied.has(key)) continue;
    if (Object.keys(kept).length >= FLUID_LIMITS.maxProxyHeaders) break;
    kept[key] = value.slice(0, FLUID_LIMITS.maxProxyHeaderChars);
  }

  return Object.keys(kept).length > 0 ? { headers: kept } : {};
}

/**
 * A raw body is opaque, but when it is JSON with a `model` field the grant's
 * model allow-list can still be applied. Apps that put the model elsewhere rely
 * on the provider's own key permissions.
 */
function enforceModelScope(permission: FluidPermission, body: string | undefined): void {
  if (!permission.models?.length || !body) return;

  let model: unknown;
  try {
    model = (JSON.parse(body) as { model?: unknown }).model;
  } catch {
    return;
  }
  if (typeof model !== "string") return;

  const separator = model.indexOf(":");
  const bare = separator === -1 ? model : model.slice(separator + 1);
  if (!permission.models.includes(model) && !permission.models.includes(bare)) {
    throw new FluidError(
      FluidErrorCode.ModelNotAllowed,
      `Model "${model}" was not granted to this connection.`,
    );
  }
}

interface ProxyLogInput {
  id: string;
  origin: string;
  appId?: string;
  providerId: string;
  label: string;
  status: number;
  startedAt: number;
  truncated?: boolean;
  errorCode?: number;
}

/**
 * Metadata only: the wallet cannot tell what an app is sending, so it never
 * stores the body or the response content for a raw request.
 */
async function writeProxyLog(input: ProxyLogInput): Promise<void> {
  const finishedAt = Date.now();
  await db().inferenceLogs.put({
    id: input.id,
    origin: input.origin,
    appId: input.appId,
    providerId: input.providerId,
    // Reuses the model column so raw calls are legible in the activity list.
    model: input.label.slice(0, 80),
    status: input.errorCode
      ? "error"
      : input.truncated
        ? "cancelled"
        : input.status >= 400
          ? "error"
          : "success",
    startedAt: input.startedAt,
    finishedAt,
    durationMs: finishedAt - input.startedAt,
    errorCode: input.errorCode ?? (input.status >= 400 ? input.status : undefined),
  });
}
