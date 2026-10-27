import {
  FLUID_GLOBAL_NAME,
  FLUID_LIMITS,
  FLUID_MESSAGE_CHANNEL,
  FluidErrorCode,
  PROTOCOL_VERSION,
  type FluidBridge,
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
}

interface BridgeEnvelope {
  channel?: string;
  kind?: string;
  response?: FluidResponse;
  event?: FluidEvent;
}

function isEnvelope(value: unknown): value is BridgeEnvelope {
  return typeof value === "object" && value !== null && (value as BridgeEnvelope).channel === FLUID_MESSAGE_CHANNEL;
}

/**
 * Runs in the page's own JS context so `window.fluid` is visible to the app.
 *
 * This script has no access to extension APIs on purpose: everything it needs
 * goes through `window.postMessage` to the isolated relay, which is the only
 * place allowed to talk to the service worker.
 */
function installBridge(): void {
  const pending = new Map<string, PendingRequest>();
  const handlers = new Set<(event: FluidEvent) => void>();

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== window || !isEnvelope(event.data)) return;
    const envelope = event.data;

    if (envelope.kind === FLUID_KIND.response && envelope.response) {
      const entry = pending.get(envelope.response.id);
      if (!entry) return;
      window.clearTimeout(entry.timer);
      pending.delete(envelope.response.id);
      entry.resolve(envelope.response);
      return;
    }

    if (envelope.kind === FLUID_KIND.event && envelope.event) {
      for (const handler of handlers) handler(envelope.event);
    }
  });

  const bridge: FluidBridge = {
    protocolVersion: PROTOCOL_VERSION,
    request(request: FluidRequest): Promise<FluidResponse> {
      return new Promise<FluidResponse>((resolve) => {
        // Inference streams for as long as the model produces tokens, so it
        // gets its own deadline instead of the generic request timeout.
        const deadlineMs = request.method.startsWith("inference.")
          ? FLUID_LIMITS.inferenceTimeoutMs
          : FLUID_LIMITS.requestTimeoutMs;

        const timer = window.setTimeout(() => {
          pending.delete(request.id);
          resolve({
            jsonrpc: "2.0",
            id: request.id,
            error: {
              code: FluidErrorCode.Timeout,
              message: "Fluid Wallet did not respond in time.",
            },
          });
        }, deadlineMs);

        pending.set(request.id, { resolve, timer });
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
    if (window.fluid) return;
    installBridge();
  },
});
