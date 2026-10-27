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

export async function sendToTab(tabId: number, event: FluidEvent): Promise<void> {
  const message: FluidBackgroundEvent = { type: FLUID_BACKGROUND_EVENT, event };
  try {
    await browser.tabs.sendMessage(tabId, message);
  } catch {
    // The tab navigated away or was closed. Losing a stream event is not worth
    // failing the request that produced it.
  }
}

/** Emits an event to the tab that owns `requestId`. */
export async function emit(requestId: string, event: FluidEvent): Promise<void> {
  const tabId = tabsByRequest.get(requestId);
  if (tabId === undefined) return;
  await sendToTab(tabId, event);
}

/** Broadcasts an event to every tab the wallet has talked to. */
export async function broadcast(event: FluidEvent): Promise<void> {
  const tabs = new Set(tabsByRequest.values());
  await Promise.all([...tabs].map((tabId) => sendToTab(tabId, event)));
}
