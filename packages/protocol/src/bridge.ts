import { FLUID_GLOBAL_NAME } from "./version";
import type { FluidEvent, FluidRequest, FluidResponse } from "./types";

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
