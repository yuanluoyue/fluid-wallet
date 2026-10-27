import { browser } from "wxt/browser";

import type { UiEnvelope, UiMessage } from "./internal";

/**
 * Sends a wallet-internal message from an extension page.
 *
 * The envelope keeps "the call failed" separate from "the wallet answered with
 * an error", so callers never have to inspect raw response shapes.
 */
export async function send<T>(message: UiMessage): Promise<T> {
  const response = (await browser.runtime.sendMessage(message)) as UiEnvelope<T> | undefined;
  if (!response) throw new Error("The wallet did not respond. Try unlocking it again.");
  if (response.error) throw new Error(response.error);
  return response.result as T;
}
