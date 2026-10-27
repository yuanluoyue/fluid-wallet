import type { FluidEvent, FluidRequest, FluidResponse } from "@fluid-wallet/protocol";

/** Message kinds carried over `window.postMessage` between the page and the bridge. */
export const FLUID_KIND = {
  request: "request",
  response: "response",
  event: "event",
} as const;

/** Message type used for the isolated content script → service worker hop. */
export const FLUID_BACKGROUND_REQUEST = "fluid:background-request";

/** Message type used by the service worker to push stream events into a tab. */
export const FLUID_BACKGROUND_EVENT = "fluid:background-event";

export interface FluidBackgroundRequest {
  type: typeof FLUID_BACKGROUND_REQUEST;
  request: FluidRequest;
}

export interface FluidBackgroundEvent {
  type: typeof FLUID_BACKGROUND_EVENT;
  event: FluidEvent;
}

export function isFluidBackgroundRequest(value: unknown): value is FluidBackgroundRequest {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FluidBackgroundRequest>;
  return candidate.type === FLUID_BACKGROUND_REQUEST && typeof candidate.request === "object";
}

export function isFluidBackgroundEvent(value: unknown): value is FluidBackgroundEvent {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FluidBackgroundEvent>;
  return candidate.type === FLUID_BACKGROUND_EVENT && typeof candidate.event === "object";
}

/**
 * Resolves the origin of the frame that sent a message.
 *
 * The browser-provided sender is the only trustworthy source: a page can put
 * anything it likes inside its own payload. When the origin is unavailable we
 * fail closed instead of guessing.
 */
export function resolveSenderOrigin(sender: { origin?: string; url?: string }): string | null {
  if (sender.origin) return sender.origin;
  if (!sender.url) return null;
  try {
    return new URL(sender.url).origin;
  } catch {
    return null;
  }
}

export type { FluidEvent, FluidRequest, FluidResponse };
