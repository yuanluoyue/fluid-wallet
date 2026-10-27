/**
 * Name of the global injected into every page: `window.fluid`.
 *
 * This is not a browser API — a page must treat it as optional and handle the
 * "wallet not installed" case.
 */
export const FLUID_GLOBAL_NAME = "fluid";

/** `postMessage` channel used between the injected bridge and the isolated relay. */
export const FLUID_MESSAGE_CHANNEL = "@fluid-wallet/protocol";

/** Version of the Fluid Protocol implemented by this package. */
export const PROTOCOL_VERSION = "0.1.0";

/** Oldest protocol version this implementation still accepts. */
export const MIN_SUPPORTED_PROTOCOL_VERSION = "0.1.0";
