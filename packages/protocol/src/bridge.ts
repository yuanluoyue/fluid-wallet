import { FLUID_GLOBAL_NAME } from "./version";
import type { FluidEvent, FluidRequest, FluidResponse } from "./types";

/**
 * What the page-side script knows about its own pipe.
 *
 * Two scripts make a wallet work in a page: the bridge (this object, running in
 * the page's own JS context) and an isolated content script that is the only
 * one allowed to talk to the extension. A page can see the first and cannot see
 * the second, so when nothing answers it can only say "no answer" — which is
 * useless, because the two halves fail for different reasons and one of them
 * (the relay) silently dies whenever the extension is reloaded under an open
 * tab. These counters are how the page tells them apart.
 */
export interface FluidBridgeDiagnostics {
  /** The relay announced itself, so something is listening on the page side. */
  relay: boolean;
  /** How long after page start the relay said hello. */
  relayAnnouncedAfterMs?: number;
  requests: number;
  answers: number;
}

/**
 * Object exposed by the injected page script as `window.fluid`.
 *
 * Anything a page does goes through this surface — it is the whole public
 * contract between an app and a wallet implementation.
 */
export interface FluidBridge {
  readonly protocolVersion: string;
  readonly walletVersion?: string;
  request(request: FluidRequest): Promise<FluidResponse>;
  onEvent(handler: (event: FluidEvent) => void): () => void;
  /** Optional: older wallet builds have no counters to report. */
  diagnostics?(): FluidBridgeDiagnostics;
}

export function isFluidBridge(value: unknown): value is FluidBridge {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<FluidBridge>;
  return (
    typeof candidate.request === "function" &&
    typeof candidate.onEvent === "function" &&
    typeof candidate.protocolVersion === "string"
  );
}

/** Reads `window.fluid` without assuming the wallet is installed. */
export function getFluidBridge(scope: unknown = globalThis): FluidBridge | undefined {
  if (typeof scope !== "object" || scope === null) return undefined;
  const candidate = (scope as Record<string, unknown>)[FLUID_GLOBAL_NAME];
  return isFluidBridge(candidate) ? candidate : undefined;
}
