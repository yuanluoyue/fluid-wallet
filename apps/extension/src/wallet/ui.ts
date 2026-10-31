import { FluidError, type FluidCapability } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

import type { UiMessage } from "../internal";
import { decideApproval, listPending, type ApprovalDecision } from "./approval";
import { exportBackup, importBackup } from "./backup";
import { getDailyLimit, setDailyLimit, usageToday } from "./budget";
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
  dailyLimit: number;
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
  requestsToday: number;
  dailyLimit: number;
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
 * alone: the message must originate from an extension URL. `sender.tab` cannot
 * be the test by itself — the first-run tab and the approval window are
 * extension pages that live in a tab — but when a tab is present its URL has to
 * be ours too, which rejects the case that matters: a web page embedding one of
 * these pages in an iframe and driving the wallet through it.
 */
export function isExtensionPage(sender: { tab?: { url?: string }; url?: string }): boolean {
  const base = browser.runtime.getURL("");
  if (typeof sender.url !== "string" || !sender.url.startsWith(base)) return false;
  if (sender.tab?.url && !sender.tab.url.startsWith(base)) return false;
  return true;
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

    case "ui:setDailyLimit":
      await setDailyLimit(message.limit);
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

    case "ui:revokeAll": {
      for (const record of await db().connections.toArray()) {
        await revokePermission(record.origin);
      }
      return connections();
    }

    case "ui:activity":
      return activity(message.limit);

    case "ui:approvals":
      return listPending();

    case "ui:decide":
      return { decided: decideApproval(message.id, message.decision as ApprovalDecision) };

    case "ui:exportBackup":
      return exportBackup(message.passphrase);

    case "ui:importBackup":
      return importBackup(message.passphrase, message.contents);

    default: {
      const unreachable: never = message;
      throw new FluidError(-32601, `Unknown UI message: ${JSON.stringify(unreachable)}`);
    }
  }
}

async function state(): Promise<UiState> {
  const [configured, unlocked, autoLockMs, dailyLimit] = await Promise.all([
    hasVault(),
    isUnlocked(),
    getAutoLock(),
    getDailyLimit(),
  ]);
  return { configured, locked: !unlocked, autoLockMs, dailyLimit };
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
  return Promise.all(
    records.map(async (record) => {
      const usage = await usageToday(record.origin);
      return {
        origin: record.origin,
        appId: record.permission.appId ?? record.appId,
        capabilities: record.permission.capabilities,
        providers: record.permission.providers,
        models: record.permission.models,
        grantedAt: record.permission.grantedAt,
        expiresAt: record.permission.expiresAt,
        requestsToday: usage.used,
        dailyLimit: usage.limit,
      };
    }),
  );
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
