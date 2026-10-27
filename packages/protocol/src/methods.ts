import type {
  FluidActivityEntry,
  FluidCapability,
  FluidConversation,
  FluidConversationDetail,
  FluidCreateSessionParams,
  FluidInferenceParams,
  FluidInferenceResult,
  FluidMessage,
  FluidModel,
  FluidPage,
  FluidPermission,
  FluidPermissionRequest,
  FluidProvider,
  FluidSession,
  FluidWalletInfo,
} from "./types";

/** Param shape for every request method. `undefined` means params may be omitted. */
export interface FluidMethodParams {
  "wallet.getInfo": undefined;
  "wallet.connect": FluidPermissionRequest;
  "wallet.disconnect": undefined;
  "wallet.getPermissions": undefined;
  "wallet.revoke": { capabilities?: FluidCapability[] } | undefined;

  "provider.list": undefined;
  "model.list": { providerId?: string } | undefined;

  "session.create": FluidCreateSessionParams | undefined;
  "session.close": { sessionId: string };

  "inference.create": FluidInferenceParams;
  "inference.cancel": { sessionId: string; inferenceId: string };

  "conversation.list": { limit?: number; cursor?: string } | undefined;
  "conversation.get": { conversationId: string };
  "conversation.append": { conversationId: string; messages: FluidMessage[] };

  "activity.list": { limit?: number; cursor?: string } | undefined;
}

/** Result shape for every request method. */
export interface FluidMethodResults {
  "wallet.getInfo": FluidWalletInfo;
  "wallet.connect": FluidPermission;
  "wallet.disconnect": { ok: true };
  "wallet.getPermissions": FluidPermission | null;
  "wallet.revoke": { revoked: boolean };

  "provider.list": FluidProvider[];
  "model.list": FluidModel[];

  "session.create": FluidSession;
  "session.close": { ok: true };

  "inference.create": FluidInferenceResult;
  "inference.cancel": { cancelled: boolean };

  "conversation.list": FluidPage<FluidConversation>;
  "conversation.get": FluidConversationDetail;
  "conversation.append": { ok: true };

  "activity.list": FluidPage<FluidActivityEntry>;
}

export type FluidMethodName = keyof FluidMethodParams;

export type FluidParamsOf<M extends FluidMethodName> = FluidMethodParams[M];

export type FluidResultOf<M extends FluidMethodName> = FluidMethodResults[M];

/** Canonical method names, so call sites never string-match by hand. */
export const FluidMethod = {
  WalletGetInfo: "wallet.getInfo",
  WalletConnect: "wallet.connect",
  WalletDisconnect: "wallet.disconnect",
  WalletGetPermissions: "wallet.getPermissions",
  WalletRevoke: "wallet.revoke",
  ProviderList: "provider.list",
  ModelList: "model.list",
  SessionCreate: "session.create",
  SessionClose: "session.close",
  InferenceCreate: "inference.create",
  InferenceCancel: "inference.cancel",
  ConversationList: "conversation.list",
  ConversationGet: "conversation.get",
  ConversationAppend: "conversation.append",
  ActivityList: "activity.list",
} as const satisfies Record<string, FluidMethodName>;

export const FLUID_METHOD_NAMES = Object.values(FluidMethod) as FluidMethodName[];

export function isFluidMethodName(value: string): value is FluidMethodName {
  return (FLUID_METHOD_NAMES as string[]).includes(value);
}

/**
 * Capability a method requires.
 *
 * `null` means the method is not gated by a standing permission: `wallet.connect`
 * runs its own approval flow, and `wallet.getInfo` is public by design.
 */
export const FLUID_METHOD_CAPABILITIES: Record<FluidMethodName, FluidCapability | null> = {
  "wallet.getInfo": null,
  "wallet.connect": null,
  "wallet.disconnect": null,
  "wallet.getPermissions": "wallet:read",
  "wallet.revoke": "wallet:read",

  "provider.list": "models:list",
  "model.list": "models:list",

  "session.create": "inference:text",
  "session.close": "inference:text",

  "inference.create": "inference:text",
  "inference.cancel": "inference:text",

  "conversation.list": "conversation:read",
  "conversation.get": "conversation:read",
  "conversation.append": "conversation:write",

  "activity.list": "activity:read",
};
