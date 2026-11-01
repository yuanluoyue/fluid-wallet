import {
  FLUID_EVENTS,
  FLUID_LIMITS,
  FLUID_PROXY_RESPONSE_HEADER_DENYLIST,
  FluidError,
  FluidErrorCode,
  FluidMethod,
  isProxyRequestHeader,
  type FluidEvent,
  type FluidProxyParams,
  type FluidProxyResponse,
  type FluidProxyStartPayload,
} from "@fluid-wallet/protocol";

import type { FluidClient } from "./client";
import { createRequestId } from "./transport";

/**
 * A `fetch` substitute: same signature, same `Response`, different route.
 *
 * Drop it into any OpenAI-compatible provider SDK (`openai`, `@ai-sdk/openai`)
 * and the request goes through the wallet, which owns the host and the key.
 */
export type FluidFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FluidFetchOptions {
  sessionId: string;
  /** Provider to route through. Omit to use the wallet's default provider. */
  providerId?: string;
  /** Deadline for the whole exchange. Defaults to the inference budget. */
  timeoutMs?: number;
  /**
   * How long the stream may be silent before it is declared dead.
   *
   * A proxied response is delivered as a series of messages from the wallet. If
   * the tab that owns them goes away — reloaded, closed, crashed — nothing else
   * arrives, and a `ReadableStream` with no more chunks never closes. Every
   * caller then waits forever: a spinner that cannot be stopped, above a
   * request that is already over. Silence is therefore a failure with a
   * time limit rather than a state to sit in.
   */
  idleTimeoutMs?: number;
  /**
   * Called once when the wallet reports the session is gone, to obtain a
   * replacement id.
   *
   * Sessions outlive neither an extension update nor the wallet's own idle
   * timeout. Without this, the first request after either event fails and keeps
   * failing — the app has a session id, the wallet has never heard of it, and
   * nothing in between knows how to make a new one.
   */
  recoverSession?: () => Promise<string>;
}

interface Head {
  status: number;
  contentType: string;
  headers: Record<string, string>;
}

/** Request headers the wallet will accept; everything else belongs to it. */
function pickRequestHeaders(headers: HeadersInit | undefined): Record<string, string> | undefined {
  if (!headers) return undefined;

  const kept: Record<string, string> = {};
  new Headers(headers).forEach((value, name) => {
    // Silently dropped rather than rejected: a real provider SDK always sets
    // `authorization` (with its own placeholder key) and sends its own
    // instrumentation headers. Failing those would make the drop-in unusable;
    // the wallet ignores them either way, because the credential is its own.
    if (isProxyRequestHeader(name)) kept[name.toLowerCase()] = value;
  });

  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Response headers to put on the `Response` handed to the caller.
 *
 * Filtered here as well as in the wallet: an older wallet sends none, and any
 * wallet could send a `content-encoding` that no longer applies to a body which
 * has been decoded to text and re-framed as a stream.
 */
function pickResponseHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};

  const denied = new Set<string>(FLUID_PROXY_RESPONSE_HEADER_DENYLIST);
  const kept: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    if (denied.has(key)) continue;
    kept[key] = value;
  }
  return kept;
}

/**
 * Builds a `fetch` that proxies provider calls through the wallet.
 *
 * The page only contributes the path: scheme, host and credentials come from
 * the provider the user configured. A `Response` is returned as soon as the
 * provider's headers arrive, so streaming works exactly as it does natively.
 */
export function createFluidFetch(client: FluidClient, options: FluidFetchOptions): FluidFetch {
  const idleTimeoutMs = options.idleTimeoutMs ?? FLUID_LIMITS.streamIdleTimeoutMs;

  return async function fluidFetch(input, init = {}): Promise<Response> {
    const url = readUrl(input);
    const body = readBody(init.body);
    const method = (init.method ?? (body === undefined ? "GET" : "POST")).toUpperCase();

    if (method !== "GET" && method !== "POST") {
      throw new FluidError(
        FluidErrorCode.InvalidParams,
        `Fluid Wallet proxies GET and POST, not ${method}.`,
      );
    }

    const headers = pickRequestHeaders(init.headers);
    const base: Omit<FluidProxyParams, "sessionId"> = {
      path: `${url.pathname}${url.search}`,
      method: method as "GET" | "POST",
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(body === undefined ? {} : { body }),
      ...(headers === undefined ? {} : { headers }),
    };

    const encoder = new TextEncoder();

    let sessionId = options.sessionId;
    let requestId = "";
    let detach: () => void = () => undefined;
    let detachAbort: () => void = () => undefined;

    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let finished = false;
    let settled = false;
    let recovered = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    let resolveHead!: (head: Head) => void;
    let rejectHead!: (error: unknown) => void;

    const head = new Promise<Head>((resolve, reject) => {
      resolveHead = resolve;
      rejectHead = reject;
    });

    const clearTimer = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    /** Re-armed by every event: only silence is a problem, not duration. */
    const armIdle = (): void => {
      if (finished || idleTimeoutMs <= 0) return;
      clearTimer();
      timer = setTimeout(() => {
        if (finished) return;
        fail(
          new FluidError(
            FluidErrorCode.Timeout,
            `No data from the wallet for ${idleTimeoutMs}ms. The request was abandoned; retry it.`,
          ),
        );
        void client.cancelInference(sessionId, requestId).catch(() => undefined);
      }, idleTimeoutMs);
    };

    const release = (): void => {
      clearTimer();
      detachAbort();
      detach();
    };

    const finish = (): void => {
      if (finished) return;
      finished = true;
      release();
      try {
        streamController?.close();
      } catch {
        // The consumer already cancelled; closing twice is not an error.
      }
    };

    const settle = (value: Head): void => {
      if (settled) return;
      settled = true;
      armIdle();
      resolveHead(value);
    };

    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        release();
        rejectHead(error);
        return;
      }
      if (finished) return;
      finished = true;
      release();
      try {
        streamController?.error(error);
      } catch {
        // Same as above: the stream may already be gone.
      }
    };

    const abort = (): void => {
      void client.cancelInference(sessionId, requestId).catch(() => undefined);
      if (settled) finish();
      else fail(new FluidError(FluidErrorCode.InferenceCancelled, "The request was aborted."));
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        abort();
      },
    });

    const handleEvent = (event: FluidEvent): void => {
      if (event.requestId !== requestId || finished) return;
      armIdle();

      switch (event.type) {
        case FLUID_EVENTS.ProxyStart: {
          const payload = event.payload as FluidProxyStartPayload;
          settle({
            status: payload.status,
            contentType: payload.contentType,
            headers: pickResponseHeaders(payload.headers),
          });
          return;
        }

        case FLUID_EVENTS.ProxyChunk: {
          const { text } = event.payload as { text: string };
          try {
            streamController?.enqueue(encoder.encode(text));
          } catch {
            finished = true;
            release();
          }
          return;
        }

        case FLUID_EVENTS.ProxyEnd: {
          const { truncated } = event.payload as { truncated?: boolean };
          if (truncated) {
            // The body stopped in the middle. Reporting that as a clean ending
            // hands a half-written answer to the caller as a complete one — a
            // truncated tool call is then executed, a truncated JSON parses as
            // a prefix, and an agent continues from a false premise.
            fail(
              new FluidError(
                FluidErrorCode.InferenceCancelled,
                "The wallet truncated this response before it finished.",
              ),
            );
            return;
          }
          finish();
          return;
        }

        case FLUID_EVENTS.ProxyError: {
          const { error } = event.payload as { error: { code: number; message: string } };
          fail(FluidError.from(error));
          return;
        }

        default:
          return;
      }
    };

    /** Starts one attempt; the listener is re-bound because the id changes. */
    const startAttempt = (): Promise<FluidProxyResponse> => {
      requestId = createRequestId();
      detach = client.onEvent(handleEvent);
      return client.call(
        FluidMethod.InferenceProxy,
        { ...base, sessionId },
        {
          requestId,
          timeoutMs: options.timeoutMs ?? FLUID_LIMITS.inferenceTimeoutMs,
        },
      );
    };

    const canRecover = (error: unknown): boolean =>
      options.recoverSession !== undefined &&
      !recovered &&
      !settled &&
      (FluidError.is(error, FluidErrorCode.SessionExpired) ||
        FluidError.is(error, FluidErrorCode.SessionNotFound));

    void (async () => {
      try {
        let result: FluidProxyResponse;
        try {
          result = await startAttempt();
        } catch (error) {
          if (!canRecover(error) || !options.recoverSession) throw error;
          recovered = true;
          detach();
          sessionId = await options.recoverSession();
          result = await startAttempt();
        }

        // A wallet that never emitted `proxy.start` still has to produce a
        // Response head; this also unblocks a stream that ended immediately.
        settle({
          status: result.status,
          contentType: result.contentType,
          headers: {},
        });
        finish();
      } catch (error) {
        fail(error);
      } finally {
        detach();
      }
    })();

    if (init.signal) {
      if (init.signal.aborted) {
        abort();
      } else {
        init.signal.addEventListener("abort", abort, { once: true });
        detachAbort = () => init.signal?.removeEventListener("abort", abort);
      }
    }

    const info = await head;
    const status = info.status >= 200 && info.status <= 599 ? info.status : 502;
    return new Response(stream, {
      status,
      headers: {
        ...(info.contentType ? { "content-type": info.contentType } : {}),
        ...info.headers,
      },
    });
  };
}

function readUrl(input: string | URL | Request): URL {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, "https://provider.invalid");
  } catch {
    throw new FluidError(FluidErrorCode.InvalidParams, `"${raw}" is not a valid request URL.`);
  }
}

/**
 * Only serialised bodies are proxied.
 *
 * Supporting uploads would mean passing streams through the extension message
 * channel, which is not worth pretending to support until something needs it.
 */
function readBody(body: BodyInit | null | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  throw new FluidError(
    FluidErrorCode.InvalidParams,
    "Fluid Wallet proxies string bodies only; streams and FormData are not supported yet.",
  );
}
