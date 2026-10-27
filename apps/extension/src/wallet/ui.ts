import { FluidError, type FluidCapability } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

import type { UiMessage } from "../internal";
import { decideApproval, listPending, type ApprovalDecision } from "./approval";
import { db } from "./db";
import { revokePermission } from "./dispatch";
import {
  deleteProvider,
  getDefaultProviderId,
  listRecords,
  saveProvider,
  setDefaultProvider,
  testProvider,
} from "./providers";
import { changePassword, getAutoLock, hasVault, isUnlocked, lock, setAutoLock, setupVault, unlock } from "./vault";

export interface UiState {
  configured: boolean;
  locked: boolean;
  autoLockMs: number;
}

export interface ProviderView {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel?: string;
  hasKey: boolean;
  isDefault: boolean;
  updatedAt: number;
}

export interface ConnectionView {
  origin: string;
  appId?: string;
  capabilities: FluidCapability[];
  providers: string[];
  models?: string[];
  grantedAt: number;
  expiresAt?: number;
}

export interface ActivityView {
  id: string;
  origin: string;
  providerId: string;
  model: string;
  status: "success" | "error" | "cancelled" | "timeout";
  startedAt: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  errorCode?: number;
}

/**
 * Only extension pages may use this surface.
 *
 * A content script also carries our extension id, so the check cannot be the id
 * alone: UI messages must not come from a tab, and must originate from an
 * extension URL.
 */
export function isExtensionPage(sender: { tab?: unknown; url?: string }): boolean {
  if (sender.tab) return false;
  const base = browser.runtime.getURL("");
  return typeof sender.url === "string" && sender.url.startsWith(base);
}

export async function handleUi(message: UiMessage): Promise<unknown> {
  switch (message.type) {
    case "ui:state":
      return state();

    case "ui:setup":
      await setupVault(message.password);
      return state();

    case "ui:unlock":
      await unlock(message.password);
      return state();

    case "ui:lock":
      await lock();
      return state();

    case "ui:changePassword":
      await changePassword(message.current, message.next);
      return state();

    case "ui:setAutoLock":
      await setAutoLock(message.ms);
      return state();

    case "ui:providers":
      return providers();

    case "ui:saveProvider":
      await saveProvider(message.input);
      return providers();

    case "ui:deleteProvider":
      await deleteProvider(message.id);
      return providers();

    case "ui:testProvider":
      return testProvider(message.id);

    case "ui:setDefaultProvider":
      await setDefaultProvider(message.id);
      return providers();

    case "ui:connections":
      return connections();

    case "ui:revoke":
      await revokePermission(message.origin);
      return connections();

    case "ui:activity":
      return activity(message.limit);

    case "ui:approvals":
      return listPending();

    case "ui:decide":
      return { decided: decideApproval(message.id, message.decision as ApprovalDecision) };

    default: {
      const unreachable: never = message;
      throw new FluidError(-32601, `Unknown UI message: ${JSON.stringify(unreachable)}`);
    }
  }
}

async function state(): Promise<UiState> {
  const [configured, unlocked, autoLockMs] = await Promise.all([
    hasVault(),
    isUnlocked(),
    getAutoLock(),
  ]);
  return { configured, locked: !unlocked, autoLockMs };
}

async function providers(): Promise<ProviderView[]> {
  const [records, defaultId] = await Promise.all([listRecords(), getDefaultProviderId()]);
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    models: record.models,
    defaultModel: record.defaultModel,
    hasKey: Boolean(record.secret),
    isDefault: record.id === defaultId,
    updatedAt: record.updatedAt,
  }));
}

async function connections(): Promise<ConnectionView[]> {
  const records = await db().connections.orderBy("updatedAt").reverse().toArray();
  return records.map((record) => ({
    origin: record.origin,
    appId: record.permission.appId ?? record.appId,
    capabilities: record.permission.capabilities,
    providers: record.permission.providers,
    models: record.permission.models,
    grantedAt: record.permission.grantedAt,
    expiresAt: record.permission.expiresAt,
  }));
}

async function activity(limit = 50): Promise<ActivityView[]> {
  const logs = await db().inferenceLogs.orderBy("startedAt").reverse().limit(limit).toArray();
  return logs.map((log) => ({
    id: log.id,
    origin: log.origin,
    providerId: log.providerId,
    model: log.model,
    status: log.status,
    startedAt: log.startedAt,
    durationMs: log.durationMs,
    inputTokens: log.inputTokens,
    outputTokens: log.outputTokens,
    errorCode: log.errorCode,
  }));
}
