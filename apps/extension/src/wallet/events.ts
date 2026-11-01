import type { FluidEvent } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

import { FLUID_BACKGROUND_EVENT, type FluidBackgroundEvent } from "../messaging";

/**
 * Tabs that are currently waiting on a request.
 *
 * Streaming events are addressed by request id, and the service worker keeps
 * the mapping so it never has to guess which tab a generation belongs to.
 */
const tabsByRequest = new Map<string, number>();

export function rememberTab(requestId: string, tabId: number | undefined): void {
  if (tabId === undefined) return;
  tabsByRequest.set(requestId, tabId);
}

export function forgetTab(requestId: string): void {
  tabsByRequest.delete(requestId);
}

/**
 * Delivers one event, and says whether it arrived.
 *
 * The answer matters for streams: a tab that navigated away or was closed has
 * no listener left, and a producer that keeps reading a provider response for
 * a page that is gone is paying for tokens nobody will ever read. Reporting
 * the failure lets the caller decide to stop, instead of discovering it after
 * the bill.
 */
export async function sendToTab(tabId: number, event: FluidEvent): Promise<boolean> {
  const message: FluidBackgroundEvent = { type: FLUID_BACKGROUND_EVENT, event };
  try {
    await browser.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // The tab navigated away or was closed. The caller decides what to do.
    return false;
  }
}

/** Emits an event to the tab that owns `requestId`. `false` means nobody got it. */
export async function emit(requestId: string, event: FluidEvent): Promise<boolean> {
  const tabId = tabsByRequest.get(requestId);
  if (tabId === undefined) return false;
  return sendToTab(tabId, event);
}

/** Broadcasts an event to every tab the wallet has talked to. */
export async function broadcast(event: FluidEvent): Promise<void> {
  const tabs = new Set(tabsByRequest.values());
  await Promise.all([...tabs].map((tabId) => sendToTab(tabId, event)));
}
