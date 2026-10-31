import { FluidError, FluidErrorCode, type FluidResponse } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { isUiMessage, type UiEnvelope } from "../src/internal";
import { isFluidBackgroundRequest, resolveSenderOrigin } from "../src/messaging";
import { dispatch } from "../src/wallet/dispatch";
import { handleUi, isExtensionPage } from "../src/wallet/ui";
import { lock } from "../src/wallet/vault";

export default defineBackground(() => {
  // The service worker can be suspended at any time: everything that must
  // outlive a request is persisted, not held in closure scope.
  //
  // `sendResponse` + `return true` rather than returning a promise: Chrome only
  // keeps a message channel open for the literal `true`, and while promise
  // returns have started rolling out (Chrome 148+) they are not everywhere and
  // never in a devtools page. A channel that closes early looks exactly like a
  // wallet that does not answer — and these requests are long-lived by design:
  // an inference request stays open until the last token arrives.
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (isFluidBackgroundRequest(message)) {
      const origin = resolveSenderOrigin(sender);
      const startedAt = Date.now();
      const method = message.request.method;
      console.debug(`[fluid-wallet] dispatch ${method} from ${origin ?? "(no origin)"}`);
      if (!origin) {
        // Without an origin the request is rejected, and a rejection that looks
        // like a hang is the hardest kind to diagnose from a page.
        console.warn(
          "[fluid-wallet] request rejected: sender origin unavailable",
          message.request.method,
        );
      }
      void dispatch(message.request, origin, sender.tab?.id).then(
        (response) => {
          console.debug(
            `[fluid-wallet] ${method} answered in ${Date.now() - startedAt}ms`,
            response.error ? `error ${response.error.code}: ${response.error.message}` : "ok",
          );
          sendResponse(response);
        },
        (error: unknown) => {
          console.error(`[fluid-wallet] ${method} threw after ${Date.now() - startedAt}ms`, error);
          sendResponse(dispatchFailed(message.request.id, error));
        },
      );
      return true;
    }

    if (isUiMessage(message)) {
      if (!isExtensionPage(sender)) {
        // A page-side script must never reach the wallet's own controls.
        sendResponse({ error: "This surface is wallet-internal." } satisfies UiEnvelope);
        return true;
      }
      void handleUi(message).then(
        (result) => sendResponse({ result } satisfies UiEnvelope),
        (error: unknown) => sendResponse({ error: describeError(error) } satisfies UiEnvelope),
      );
      return true;
    }

    return undefined;
  });

  browser.runtime.onInstalled.addListener((details) => {
    // First run: send the user straight to onboarding instead of leaving them
    // with a locked toolbar icon and no explanation.
    if (details.reason === "install") {
      void browser.tabs.create({ url: browser.runtime.getURL("/options.html?welcome=1") });
    }
  });

  // Screen lock is a stronger signal than a timer: the idle lock waits for a
  // period of disuse, but a locked laptop means the user already left.
  browser.idle?.onStateChanged.addListener((state) => {
    if (state === "locked") void lock();
  });
});

function describeError(error: unknown): string {
  if (error instanceof FluidError) return error.message;
  return error instanceof Error ? error.message : "Unexpected wallet error.";
}

/**
 * `dispatch` turns its own failures into error envelopes, so this only runs
 * when something broke outside its `try`. It exists because answering at all is
 * the point: a closed port is indistinguishable, from inside a page, from a
 * wallet that never loaded.
 */
function dispatchFailed(id: string, error: unknown): FluidResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: { code: FluidErrorCode.InternalError, message: describeError(error) },
  };
}
