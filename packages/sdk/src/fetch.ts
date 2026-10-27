import {
  FLUID_EVENTS,
  FLUID_LIMITS,
  FluidError,
  FluidErrorCode,
  FluidMethod,
  type FluidEvent,
  type FluidProxyParams,
  type FluidProxyStartPayload,
} from "@fluid-wallet/protocol";

import type { FluidClient } from "./client";
import { createRequestId } from "./transport";

/**
 * A `fetch` substitute: same signature, same `Response`, different route.
 *
 * Drop it into any provider SDK (`openai`, `@ai-sdk/openai`, `@anthropic-ai/sdk`
 * with a compatible base URL) and the request goes through the wallet, which
 * owns the host and the key.
 */
export type FluidFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FluidFetchOptions {
  sessionId: string;
  /** Provider to route through. Omit to use the wallet's default provider. */
  providerId?: string;
  /** Deadline for the whole exchange. Defaults to the inference budget. */
  timeoutMs?: number;
}

interface Head {
  status: number;
  contentType: string;
}

/**
 * Builds a `fetch` that proxies provider calls through the wallet.
 *
 * The page only contributes the path: scheme, host and credentials come from
 * the provider the user configured. A `Response` is returned as soon as the
 * provider's headers arrive, so streaming works exactly as it does natively.
 */
export function createFluidFetch(client: FluidClient, options: FluidFetchOptions): FluidFetch {
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

    const accept = new Headers(init.headers).get("accept");
    const params: FluidProxyParams = {
      sessionId: options.sessionId,
      path: `${url.pathname}${url.search}`,
      method,
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(body === undefined ? {} : { body }),
      ...(accept ? { headers: { accept } } : {}),
    };

    const requestId = createRequestId();
    const encoder = new TextEncoder();

    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    let finished = false;
    let settled = false;
    let resolveHead!: (head: Head) => void;
    let rejectHead!: (error: unknown) => void;

    const head = new Promise<Head>((resolve, reject) => {
      resolveHead = resolve;
      rejectHead = reject;
    });

    const finish = (): void => {
      if (finished) return;
      finished = true;
      try {
        streamController?.close();
      } catch {
        // The consumer already cancelled; closing twice is not an error.
      }
    };

    const settle = (value: Head): void => {
      if (settled) return;
      settled = true;
      resolveHead(value);
    };

    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        rejectHead(error);
        return;
      }
      if (finished) return;
      finished = true;
      try {
        streamController?.error(error);
      } catch {
        // Same as above: the stream may already be gone.
      }
    };

    const abort = (): void => {
      void client.cancelInference(options.sessionId, requestId).catch(() => undefined);
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

    const detach = client.onEvent((event: FluidEvent) => {
      if (event.requestId !== requestId || finished) return;

      switch (event.type) {
        case FLUID_EVENTS.ProxyStart: {
          const payload = event.payload as FluidProxyStartPayload;
          settle({ status: payload.status, contentType: payload.contentType });
          return;
        }

        case FLUID_EVENTS.ProxyChunk: {
          const { text } = event.payload as { text: string };
          try {
            streamController?.enqueue(encoder.encode(text));
          } catch {
            finished = true;
          }
          return;
        }

        case FLUID_EVENTS.ProxyEnd: {
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
    });

    const request = client.call(FluidMethod.InferenceProxy, params, {
      requestId,
      timeoutMs: options.timeoutMs ?? FLUID_LIMITS.inferenceTimeoutMs,
    });

    void request
      .then(
        (result) => {
          // A wallet that never emitted `proxy.start` still has to produce a
          // Response head; this also unblocks a stream that ended immediately.
          settle({ status: result.status, contentType: result.contentType });
          finish();
        },
        (error: unknown) => {
          fail(error);
        },
      )
      .finally(() => detach());

    const signal = init.signal;
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    }

    const info = await head;
    const status = info.status >= 200 && info.status <= 599 ? info.status : 502;
    return new Response(stream, {
      status,
      headers: info.contentType ? { "content-type": info.contentType } : undefined,
    });
  };
}

function readUrl(input: string | URL | Request): URL {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
