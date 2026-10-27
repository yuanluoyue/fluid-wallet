import { FluidError } from "@fluid-wallet/protocol";
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
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (isFluidBackgroundRequest(message)) {
      const origin = resolveSenderOrigin(sender);
      if (!origin) {
        console.warn(
          "[fluid-wallet] request rejected: sender origin unavailable",
          message.request.method,
        );
      }
      return dispatch(message.request, origin, sender.tab?.id);
    }

    if (isUiMessage(message)) {
      if (!isExtensionPage(sender)) {
        // A page-side script must never reach the wallet's own controls.
        return Promise.resolve<UiEnvelope>({ error: "This surface is wallet-internal." });
      }
      return handleUi(message)
        .then((result): UiEnvelope => ({ result }))
        .catch((error: unknown): UiEnvelope => ({
          error:
            error instanceof FluidError
              ? error.message
              : error instanceof Error
                ? error.message
                : "Unexpected wallet error.",
        }));
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
