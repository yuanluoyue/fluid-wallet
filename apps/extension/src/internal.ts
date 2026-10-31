import type { ApprovalDecision } from "./wallet/approval";
import type { ProbeInput, ProviderInput } from "./wallet/providers";

/** Message type for the extension's own UI pages (popup, options). */
export const UI_MESSAGE = "fluid:ui";

export type UiMessage =
  | { type: "ui:state" }
  | { type: "ui:setup"; password: string }
  | { type: "ui:unlock"; password: string }
  | { type: "ui:lock" }
  | { type: "ui:changePassword"; current: string; next: string }
  | { type: "ui:setAutoLock"; ms: number }
  | { type: "ui:setDailyLimit"; limit: number }
  | { type: "ui:providers" }
  | { type: "ui:saveProvider"; input: ProviderInput }
  | { type: "ui:deleteProvider"; id: string }
  | { type: "ui:testProvider"; input: ProbeInput }
  | { type: "ui:listModels"; input: ProbeInput }
  | { type: "ui:setDefaultProvider"; id: string }
  | { type: "ui:connections" }
  | { type: "ui:revoke"; origin: string }
  | { type: "ui:revokeAll" }
  | { type: "ui:activity"; limit?: number }
  | { type: "ui:approvals" }
  | { type: "ui:decide"; id: string; decision: ApprovalDecision }
  | { type: "ui:exportBackup"; passphrase: string }
  | { type: "ui:importBackup"; passphrase: string; contents: string };

export interface UiEnvelope<T = unknown> {
  result?: T;
  error?: string;
}

export function isUiMessage(value: unknown): value is UiMessage {
  if (typeof value !== "object" || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && type.startsWith("ui:");
}
