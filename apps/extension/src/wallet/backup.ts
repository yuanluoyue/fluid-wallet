import { openFile, sealFile } from "@fluid-wallet/crypto";
import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";

import { db } from "./db";
import { listRecords, saveProvider } from "./providers";
import { openString } from "./vault";

export const BACKUP_FORMAT = "fluid-wallet-backup";

/** A provider as it travels in a backup: the key is plaintext until resealed. */
interface BackupProvider {
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  defaultModel?: string;
  apiKey?: string;
}

interface BackupPayload {
  version: 1;
  createdAt: number;
  providers: BackupProvider[];
}

export interface ExportResult {
  filename: string;
  contents: string;
  providers: number;
}

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
}

/**
 * Writes every credential into one passphrase-protected file.
 *
 * Grants, sessions, logs and conversations are deliberately left out. A
 * permission is a decision this wallet made about a specific origin on this
 * machine; carrying it to another machine would silently re-authorise apps the
 * user never re-approved. Keys are portable, decisions are not.
 */
export async function exportBackup(passphrase: string): Promise<ExportResult> {
  const records = await listRecords();
  const providers: BackupProvider[] = [];

  for (const record of records) {
    if (!record.secret) continue;
    providers.push({
      id: record.id,
      name: record.name,
      baseUrl: record.baseUrl,
      models: record.models,
      defaultModel: record.defaultModel,
      apiKey: await openString(record.secret),
    });
  }

  if (providers.length === 0) {
    throw new FluidError(
      FluidErrorCode.InvalidParams,
      "There is nothing to back up yet. Add a provider first.",
    );
  }

  const contents = await sealFile({
    format: BACKUP_FORMAT,
    passphrase,
    value: { version: 1, createdAt: Date.now(), providers } satisfies BackupPayload,
  });

  return {
    filename: `fluid-wallet-backup-${new Date().toISOString().slice(0, 10)}.json`,
    contents,
    providers: providers.length,
  };
}

/**
 * Merges a backup file into this wallet.
 *
 * Matching is by provider id, so importing the same file twice updates in place
 * instead of stacking duplicates.
 */
export async function importBackup(passphrase: string, contents: string): Promise<ImportResult> {
  const payload = await openFile<BackupPayload>(contents, passphrase, BACKUP_FORMAT);
  if (!Array.isArray(payload?.providers)) {
    throw new FluidError(FluidErrorCode.InvalidParams, "The backup has no providers in it.");
  }

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const provider of payload.providers) {
    if (!provider?.id || !provider.baseUrl || !Array.isArray(provider.models)) {
      skipped += 1;
      continue;
    }

    const existing = await db().providers.get(provider.id);
    if (!existing && !provider.apiKey) {
      // Nothing to seal it with: an entry without a key cannot become a provider.
      skipped += 1;
      continue;
    }

    await saveProvider({
      id: provider.id,
      name: provider.name ?? provider.id,
      baseUrl: provider.baseUrl,
      models: provider.models,
      defaultModel: provider.defaultModel,
      ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
    });

    if (existing) updated += 1;
    else imported += 1;
  }

  return { imported, updated, skipped };
}
