import {
  FLUID_GLOBAL_NAME,
  FLUID_LIMITS,
  FLUID_MESSAGE_CHANNEL,
  FluidErrorCode,
  PROTOCOL_VERSION,
  type FluidBridge,
  type FluidBridgeAttempt,
  type FluidEvent,
  type FluidRequest,
  type FluidResponse,
} from "@fluid-wallet/protocol";
import { defineContentScript } from "wxt/utils/define-content-script";

import { FLUID_KIND } from "../src/messaging";

declare global {
  interface Window {
    fluid?: FluidBridge;
  }
}

interface PendingRequest {
  resolve: (response: FluidResponse) => void;
  timer: number;
  method: string;
  sentAt: number;
}

interface BridgeEnvelope {
  channel?: string;
  kind?: string;
  response?: FluidResponse;
  event?: FluidEvent;
}

function isEnvelope(value: unknown): value is BridgeEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as BridgeEnvelope).channel === FLUID_MESSAGE_CHANNEL
  );
}

/**
 * Runs in the page's own JS context so `window.fluid` is visible to the app.
 *
 * This script has no access to extension APIs on purpose: everything it needs
 * goes through `window.postMessage` to the isolated relay, which is the only
 * place allowed to talk to the service worker.
 */
function installBridge(): void {
  const startedAt = Date.now();
  const pending = new Map<string, PendingRequest>();
  const handlers = new Set<(event: FluidEvent) => void>();
  const stats = {
    requests: 0,
    answers: 0,
    events: 0,
    relayAnnouncedAt: null as number | null,
    last: undefined as FluidBridgeAttempt | undefined,
  };

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isEnvelope(event.data)) return;
    const envelope = event.data;

    if (envelope.kind === FLUID_KIND.ready) {
      stats.relayAnnouncedAt ??= Date.now();
      console.debug(`[fluid-wallet] relay announced after ${stats.relayAnnouncedAt - startedAt}ms`);
      return;
    }

    if (envelope.kind === FLUID_KIND.response && envelope.response) {
      const entry = pending.get(envelope.response.id);
      if (!entry) {
        // An answer nobody is waiting for: the request already hit its deadline,
        // or the id was rewritten in flight. Both are worth seeing.
        console.debug(
          `[fluid-wallet] answer for unknown request ${envelope.response.id}`,
          envelope.response.error?.message ?? "ok",
        );
        return;
      }
      window.clearTimeout(entry.timer);
      pending.delete(envelope.response.id);
      stats.answers += 1;
      const elapsedMs = Date.now() - entry.sentAt;
      const error = envelope.response.error;
      stats.last = {
        method: entry.method,
        id: envelope.response.id,
        answeredAfterMs: elapsedMs,
        ...(error ? { errorCode: error.code, error: error.message } : {}),
      };
      console.debug(
        `[fluid-wallet] answer ${entry.method} in ${elapsedMs}ms`,
        error ? `error ${error.code}: ${error.message}` : "ok",
      );
      entry.resolve(envelope.response);
      return;
    }

    if (envelope.kind === FLUID_KIND.event && envelope.event) {
      stats.events += 1;
      for (const handler of handlers) handler(envelope.event);
    }
  });

  const bridge: FluidBridge = {
    protocolVersion: PROTOCOL_VERSION,
    diagnostics() {
      return {
        relay: stats.relayAnnouncedAt !== null,
        ...(stats.relayAnnouncedAt === null
          ? {}
          : { relayAnnouncedAfterMs: stats.relayAnnouncedAt - startedAt }),
        requests: stats.requests,
        answers: stats.answers,
        pending: pending.size,
        events: stats.events,
        ...(stats.last ? { last: stats.last } : {}),
      };
    },
    request(request: FluidRequest): Promise<FluidResponse> {
      return new Promise<FluidResponse>((resolve) => {
        // Inference streams for as long as the model produces tokens, so it
        // gets its own deadline instead of the generic request timeout.
        const deadlineMs = request.method.startsWith("inference.")
          ? FLUID_LIMITS.inferenceTimeoutMs
          : FLUID_LIMITS.requestTimeoutMs;

        stats.requests += 1;
        const sentAt = Date.now();
        stats.last = { method: request.method, id: request.id };
        console.debug(
          `[fluid-wallet] request ${request.method} relay=${stats.relayAnnouncedAt !== null}`,
        );

        const timer = window.setTimeout(() => {
          pending.delete(request.id);
          console.debug(
            `[fluid-wallet] ${request.method} got no answer in ${deadlineMs}ms (relay=${stats.relayAnnouncedAt !== null}, pending=${pending.size})`,
          );
          resolve({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: FluidErrorCode.Timeout,
              message: "Fluid Wallet did not respond in time.",
            },
          });
        }, deadlineMs);

        pending.set(request.id, { resolve, timer, method: request.method, sentAt });
        window.postMessage(
          { channel: FLUID_MESSAGE_CHANNEL, kind: FLUID_KIND.request, request },
          window.location.origin,
        );
      });
    },
    onEvent(handler: (event: FluidEvent) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
  };

  Object.defineProperty(window, FLUID_GLOBAL_NAME, {
    value: bridge,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    if (window.fluid) {
      // A bridge from an earlier injection outlives the extension that put it
      // there. Keeping it is correct (replacing it would orphan every in-flight
      // request), but it is worth saying out loud: this page is running the old
      // build.
      console.debug("[fluid-wallet] bridge already present; keeping the existing one");
      return;
    }
    installBridge();
  },
});
