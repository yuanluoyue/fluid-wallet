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

    const fail = (id: string, message: string): void => {
      postToPage({
        kind: FLUID_KIND.response,
        response: {
          jsonrpc: "2.0",
          id,
          error: { code: FluidErrorCode.InternalError, message },
        },
      });
    };

    window.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (event.source !== window) return;

      const data = event.data as PageRequestEnvelope | null;
      if (!data || data.channel !== FLUID_MESSAGE_CHANNEL) return;
      if (!data.kind || data.kind !== FLUID_KIND.request || !data.request) return;

      const request = data.request;

      // An extension can be reloaded or updated while a tab stays open. This
      // script keeps running, but its `runtime` is gone: every call throws
      // "Extension context invalidated", nothing is forwarded, and from the page
      // that is indistinguishable from a wallet that is not installed at all.
      // Saying so is the difference between a dead end and "reload the page".
      const runtime = browser.runtime;
      if (!runtime?.id) {
        fail(request.id, "The wallet was reloaded or updated. Reload this page to reconnect.");
        return;
      }

      try {
        runtime
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
            fail(
              request.id,
              error instanceof Error ? error.message : "Fluid Wallet bridge failed.",
            );
          });
      } catch (error) {
        // `sendMessage` throws synchronously once the context is invalidated,
        // so the rejection path above never runs.
        fail(
          request.id,
          error instanceof Error
            ? error.message
            : "The wallet connection is gone. Reload this page.",
        );
      }
    });

    // Stream events are pushed by the service worker via `tabs.sendMessage`.
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isFluidBackgroundEvent(message)) return undefined;
      postToPage({ kind: FLUID_KIND.event, event: message.event });
      return undefined;
    });

    // The bridge cannot see this script, so it has to say hello: that single
    // bit is what lets a page tell "the relay was reloaded away" from "the
    // wallet's worker is stuck".
    postToPage({ kind: FLUID_KIND.ready });
  },
});
