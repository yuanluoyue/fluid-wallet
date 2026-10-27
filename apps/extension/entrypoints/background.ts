import {
  FluidError,
  FluidErrorCode,
  FluidMethod,
  GRANTABLE_CAPABILITIES,
  PROTOCOL_VERSION,
  type FluidErrorShape,
  type FluidRequest,
  type FluidResponse,
  type FluidWalletInfo,
} from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";

import { isFluidBackgroundRequest, resolveSenderOrigin } from "../src/messaging";

const WALLET_VERSION = "0.0.0";

function ok<T>(id: string, result: T): FluidResponse<T> {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: string, error: FluidErrorShape): FluidResponse {
  return { jsonrpc: "2.0", id, error };
}

function toErrorShape(error: unknown): FluidErrorShape {
  if (error instanceof FluidError) return error.toJSON();
  return {
    code: FluidErrorCode.InternalError,
    message: error instanceof Error ? error.message : "Unexpected wallet error.",
  };
}

function describeWallet(): FluidWalletInfo {
  return {
    name: "Fluid Wallet",
    walletVersion: WALLET_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    capabilities: [...GRANTABLE_CAPABILITIES],
    locked: true,
  };
}

/**
 * Single entry point for every page request.
 *
 * Scaffold stage: only `wallet.getInfo` is wired up. Permission grants,
 * sessions and inference land in MVP-02, but they must all come through here so
 * origin and permission checks live in exactly one place.
 */
async function dispatch(request: FluidRequest, origin: string | null): Promise<FluidResponse> {
  try {
    if (!origin) {
      throw new FluidError(
        FluidErrorCode.OriginMismatch,
        "Unable to verify the sender origin; refusing the request.",
      );
    }

    switch (request.method) {
      case FluidMethod.WalletGetInfo:
        return ok(request.id, describeWallet());

      default:
        throw new FluidError(
          FluidErrorCode.MethodNotFound,
          `Method "${request.method}" is not implemented in this build.`,
          { origin },
        );
    }
  } catch (error) {
    return fail(request.id, toErrorShape(error));
  }
}

export default defineBackground(() => {
  // The service worker can be suspended at any time, so no request state is
  // kept in closure scope beyond the lifetime of a single message.
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isFluidBackgroundRequest(message)) return undefined;

    const origin = resolveSenderOrigin(sender);
    if (!origin) {
      console.warn("[fluid-wallet] request rejected: sender origin unavailable", message.request.method);
    }

    return dispatch(message.request, origin);
  });
});
