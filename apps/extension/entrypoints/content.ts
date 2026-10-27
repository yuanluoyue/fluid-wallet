import {
  FLUID_MESSAGE_CHANNEL,
  FluidErrorCode,
  type FluidRequest,
  type FluidResponse,
} from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";

import { FLUID_BACKGROUND_REQUEST, FLUID_KIND, isFluidBackgroundEvent } from "../src/messaging";

interface PageRequestEnvelope {
  channel?: string;
  kind?: string;
  request?: FluidRequest;
}

function isResponse(value: unknown): value is FluidResponse {
  return typeof value === "object" && value !== null && "id" in value;
}

/**
 * Isolated-world relay.
 *
 * It is the only script that can reach `chrome.runtime`, and it deliberately
 * forwards opaque envelopes: it never inspects params or results, so business
 * rules stay inside the service worker.
 */
export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const postToPage = (payload: Record<string, unknown>): void => {
      window.postMessage({ channel: FLUID_MESSAGE_CHANNEL, ...payload }, window.location.origin);
    };

    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.source !== window) return;

      const data = event.data as PageRequestEnvelope | null;
      if (!data || data.channel !== FLUID_MESSAGE_CHANNEL) return;
      if (data.kind !== FLUID_KIND.request || !data.request) return;

      const request = data.request;

      browser.runtime
        .sendMessage({ type: FLUID_BACKGROUND_REQUEST, request })
        .then((response: unknown) => {
          postToPage({
            kind: FLUID_KIND.response,
            response: isResponse(response)
              ? response
              : {
                  jsonrpc: "2.0",
                  id: request.id,
                  error: {
                    code: FluidErrorCode.InternalError,
                    message: "Fluid Wallet returned an invalid response envelope.",
                  },
                },
          });
        })
        .catch((error: unknown) => {
          postToPage({
            kind: FLUID_KIND.response,
            response: {
              jsonrpc: "2.0",
              id: request.id,
              error: {
                code: FluidErrorCode.InternalError,
                message: error instanceof Error ? error.message : "Fluid Wallet bridge failed.",
              },
            },
          });
        });
    });

    // Stream events are pushed by the service worker via `tabs.sendMessage`.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isFluidBackgroundEvent(message)) return undefined;
      postToPage({ kind: FLUID_KIND.event, event: message.event });
      return undefined;
    });
  },
});
