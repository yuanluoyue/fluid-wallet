import { createFluidDatabase, type FluidDatabase } from "@fluid-wallet/core";

let instance: FluidDatabase | null = null;

/**
 * One Dexie handle per service worker instance.
 *
 * The worker is allowed to be suspended, so nothing here may be cached across
 * requests beyond the handle itself — Dexie reopens the connection on demand.
 */
export function db(): FluidDatabase {
  instance ??= createFluidDatabase();
  return instance;
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const record = await db().settings.get(key);
  return record?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db().settings.put({ key, value, updatedAt: Date.now() });
}

export async function deleteSetting(key: string): Promise<void> {
  await db().settings.delete(key);
}
