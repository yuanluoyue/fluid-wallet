import {
  FLUID_LIMITS,
  FLUID_MESSAGE_CHANNEL,
  FluidError,
  FluidErrorCode,
  getFluidBridge,
  type FluidBridge,
  type FluidBridgeDiagnostics,
  type FluidEvent,
  type FluidRequest,
  type FluidResponse,
} from "@fluid-wallet/protocol";

export interface FluidRequestOptions {
  /** Pre-generated id so streaming events can be correlated before the promise settles. */
  requestId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * How the SDK reaches a wallet.
 *
 * Only the transport knows about `window`; everything above it works with plain
 * promises and events, which is what makes the mock wallet usable in tests.
 */
export interface FluidTransport {
  readonly kind: "bridge" | "post-message" | "unavailable";
  request<TResult = unknown>(
    method: string,
    params?: unknown,
    options?: FluidRequestOptions,
  ): Promise<TResult>;
  onEvent(handler: (event: FluidEvent) => void): () => void;
  dispose(): void;
  /** Only the bridge transport can report on the page-side pipe. */
  diagnostics?(): FluidBridgeDiagnostics | undefined;
}

export function createRequestId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `fluid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function unwrap<TResult>(response: FluidResponse, method: string): TResult {
  if (response.error) throw FluidError.from(response.error);
  if (response.result === undefined) {
    throw new FluidError(
      FluidErrorCode.InternalError,
      `Method "${method}" resolved without a result.`,
    );
  }
  return response.result as TResult;
}

function withDeadline<T>(promise: Promise<T>, options: FluidRequestOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? FLUID_LIMITS.requestTimeoutMs;

  return new Promise<T>((resolve, reject) => {
    // A zero deadline means "wait indefinitely"; only used by long-running
    // catalog operations such as a model listing that probes the provider.
    const timer = timeoutMs > 0 ? setTimeout(() => {
      cleanup();
      reject(new FluidError(FluidErrorCode.Timeout, `Request timed out after ${timeoutMs}ms.`));
    }, timeoutMs) : undefined;

    const onAbort = (): void => {
      cleanup();
      reject(new FluidError(FluidErrorCode.InferenceCancelled, "Request cancelled by the caller."));
    };

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    };

    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    options.signal?.addEventListener("abort", onAbort, { once: true });

    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Transport over the injected `window.fluid` bridge. */
export class BridgeTransport implements FluidTransport {
  readonly kind = "bridge" as const;

  readonly #bridge: FluidBridge;

  constructor(bridge: FluidBridge) {
    this.#bridge = bridge;
  }

  async request<TResult = unknown>(
    method: string,
    params?: unknown,
    options: FluidRequestOptions = {},
  ): Promise<TResult> {
    const request: FluidRequest = {
      jsonrpc: "2.0",
      id: options.requestId ?? createRequestId(),
      method,
      ...(params === undefined ? {} : { params }),
    };

    const response = await withDeadline(this.#bridge.request(request), options);
    return unwrap<TResult>(response, method);
  }

  onEvent(handler: (event: FluidEvent) => void): () => void {
    return this.#bridge.onEvent(handler);
  }

  diagnostics(): FluidBridgeDiagnostics | undefined {
    // Older wallet builds have no counters; that is not an error, just less to
    // say about a failure.
    return this.#bridge.diagnostics?.();
  }

  dispose(): void {
    // The bridge is owned by the page, not by the client.
  }
}

interface TransportEnvelope {
  channel?: string;
  kind?: string;
  response?: FluidResponse;
  event?: FluidEvent;
}

function isEnvelope(value: unknown): value is TransportEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as TransportEnvelope).channel === FLUID_MESSAGE_CHANNEL
  );
}

/**
 * Fallback transport using `window.postMessage` only.
 *
 * Used when the wallet exposes no callable bridge, for example when the page is
 * sandboxed or the extension relies on message passing exclusively.
 */
export class PostMessageTransport implements FluidTransport {
  readonly kind = "post-message" as const;

  readonly #scope: Window;
  readonly #timeoutMs: number;
  readonly #pending = new Map<string, (response: FluidResponse) => void>();
  readonly #handlers = new Set<(event: FluidEvent) => void>();
  #disposed = false;

  readonly #handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.#scope || !isEnvelope(event.data)) return;
    const envelope = event.data;

    if (envelope.kind === "response" && envelope.response) {
      const resolve = this.#pending.get(envelope.response.id);
      if (!resolve) return;
      this.#pending.delete(envelope.response.id);
      resolve(envelope.response);
      return;
    }

    if (envelope.kind === "event" && envelope.event) {
      for (const handler of this.#handlers) handler(envelope.event);
    }
  };

  constructor(scope: Window, timeoutMs: number = FLUID_LIMITS.requestTimeoutMs) {
    this.#scope = scope;
    this.#timeoutMs = timeoutMs;
    this.#scope.addEventListener("message", this.#handleMessage);
  }

  async request<TResult = unknown>(
    method: string,
    params?: unknown,
    options: FluidRequestOptions = {},
  ): Promise<TResult> {
    if (this.#disposed) {
      throw new FluidError(FluidErrorCode.NotInstalled, "The wallet transport was disposed.");
    }

    const request: FluidRequest = {
      jsonrpc: "2.0",
      id: options.requestId ?? createRequestId(),
      method,
      ...(params === undefined ? {} : { params }),
    };

    const response = new Promise<FluidResponse>((resolve) => {
      this.#pending.set(request.id, resolve);
    });

    this.#scope.postMessage(
      { channel: FLUID_MESSAGE_CHANNEL, kind: "request", request },
      this.#scope.location.origin,
    );

    try {
      const settled = await withDeadline(response, { timeoutMs: this.#timeoutMs, ...options });
      return unwrap<TResult>(settled, method);
    } finally {
      this.#pending.delete(request.id);
    }
  }

  onEvent(handler: (event: FluidEvent) => void): () => void {
    this.#handlers.add(handler);
    return () => {
      this.#handlers.delete(handler);
    };
  }

  dispose(): void {
    this.#disposed = true;
    this.#handlers.clear();
    this.#pending.clear();
    this.#scope.removeEventListener("message", this.#handleMessage);
  }
}

/**
 * Placeholder used when there is no browser context, so importing the SDK in a
 * server render never throws. Calls fail with `NotInstalled` and a clear reason.
 */
export class UnavailableTransport implements FluidTransport {
  readonly kind = "unavailable" as const;

  readonly #reason: string;

  constructor(reason: string) {
    this.#reason = reason;
  }

  request<TResult = unknown>(): Promise<TResult> {
    return Promise.reject(new FluidError(FluidErrorCode.NotInstalled, this.#reason));
  }

  onEvent(): () => void {
    return () => undefined;
  }

  dispose(): void {
    // Nothing to release.
  }
}

/**
 * Picks the best available transport.
 *
 * A missing bridge is not an error at this point: the postMessage path may
 * still reach a wallet that only listens on the channel.
 */
export function createTransport(timeoutMs?: number, scope?: Window): FluidTransport {
  const target = scope ?? (typeof window === "undefined" ? undefined : window);
  if (!target) {
    return new UnavailableTransport(
      "Fluid Wallet needs a browser environment; pass an explicit transport instead.",
    );
  }

  const bridge = getFluidBridge(target);
  return bridge ? new BridgeTransport(bridge) : new PostMessageTransport(target, timeoutMs);
}
