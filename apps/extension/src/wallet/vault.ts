import {
  DEFAULT_KDF_ITERATIONS,
  decryptString,
  deriveKey,
  encryptString,
  exportDataKey,
  generateDataKey,
  importDataKey,
  unwrapDataKey,
  wrapDataKey,
  type EncryptedSecret,
} from "@fluid-wallet/crypto";
import { FluidError, FluidErrorCode, FLUID_EVENTS } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

import { getSetting, setSetting } from "./db";
import { broadcast } from "./events";

const KDF_SETTING = "vault.kdf";
const WRAPPED_SETTING = "vault.wrapped";
const AUTO_LOCK_SETTING = "vault.autoLockMs";
const SESSION_KEY = "fluid:vault-session";

export const DEFAULT_AUTO_LOCK_MS = 15 * 60_000;
export const MIN_PASSWORD_LENGTH = 8;

interface StoredKdf {
  salt: string;
  iterations: number;
}

interface SessionState {
  /** Raw data key, base64. Only ever written to the memory-only session area. */
  dataKey: string;
  unlockedAt: number;
  lastUsedAt: number;
}

interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * `storage.session` is memory-only and cleared when the browser closes, which
 * is exactly the lifetime we want for an unlocked wallet: surviving service
 * worker suspension, dying with the browser session.
 */
function sessionArea(): SessionArea | null {
  const storage = browser.storage as unknown as { session?: SessionArea };
  return storage.session ?? null;
}

let memory: { key: CryptoKey; lastUsedAt: number } | null = null;

async function readSession(): Promise<SessionState | null> {
  const area = sessionArea();
  if (area) {
    const stored = (await area.get(SESSION_KEY))[SESSION_KEY];
    if (stored) return stored as SessionState;
  }
  if (memory) {
    return {
      dataKey: await exportDataKey(memory.key),
      unlockedAt: memory.lastUsedAt,
      lastUsedAt: memory.lastUsedAt,
    };
  }
  return null;
}

async function writeSession(state: SessionState | null): Promise<void> {
  const area = sessionArea();
  if (!area) return;
  if (state) await area.set({ [SESSION_KEY]: state });
  else await area.remove(SESSION_KEY);
}

async function autoLockMs(): Promise<number> {
  return (await getSetting<number>(AUTO_LOCK_SETTING)) ?? DEFAULT_AUTO_LOCK_MS;
}

export async function hasVault(): Promise<boolean> {
  const [kdf, wrapped] = await Promise.all([
    getSetting<StoredKdf>(KDF_SETTING),
    getSetting<EncryptedSecret>(WRAPPED_SETTING),
  ]);
  return Boolean(kdf && wrapped);
}

/**
 * Creates the wallet for the first time.
 *
 * The password never leaves this function: it derives a wrapping key, which
 * seals a freshly generated data key. Credentials are encrypted with the data
 * key, so a password change only rewraps that one blob.
 */
export async function setupVault(password: string): Promise<void> {
  if (await hasVault()) {
    throw new FluidError(FluidErrorCode.InvalidParams, "This wallet already has a password.");
  }
  assertPassword(password);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: StoredKdf = { salt: toBase64(salt), iterations: DEFAULT_KDF_ITERATIONS };
  const kek = await deriveKey(password, salt, kdf.iterations);
  const dataKey = await generateDataKey();

  await setSetting(KDF_SETTING, kdf);
  await setSetting(WRAPPED_SETTING, await wrapDataKey(kek, dataKey, kdfToEnvelope(kdf)));
  await writeSession({
    dataKey: await exportDataKey(dataKey),
    unlockedAt: Date.now(),
    lastUsedAt: Date.now(),
  });
  memory = { key: dataKey, lastUsedAt: Date.now() };

  await broadcast({ type: FLUID_EVENTS.WalletUnlocked, payload: {} });
}

export async function unlock(password: string): Promise<void> {
  const [kdf, wrapped] = await Promise.all([
    getSetting<StoredKdf>(KDF_SETTING),
    getSetting<EncryptedSecret>(WRAPPED_SETTING),
  ]);
  if (!kdf || !wrapped) {
    throw new FluidError(FluidErrorCode.Locked, "No wallet has been set up yet.");
  }

  const kek = await deriveKey(password, fromBase64(kdf.salt), kdf.iterations);
  let dataKey: CryptoKey;
  try {
    dataKey = await unwrapDataKey(kek, wrapped);
  } catch {
    // AES-GCM authentication failure is the only realistic cause here, and it
    // always means the password is wrong.
    throw new FluidError(FluidErrorCode.Unauthorized, "Incorrect password.");
  }

  const now = Date.now();
  memory = { key: dataKey, lastUsedAt: now };
  await writeSession({ dataKey: await exportDataKey(dataKey), unlockedAt: now, lastUsedAt: now });
  await broadcast({ type: FLUID_EVENTS.WalletUnlocked, payload: {} });
}

export async function lock(): Promise<void> {
  memory = null;
  await writeSession(null);
  await broadcast({ type: FLUID_EVENTS.WalletLocked, payload: {} });
}

export async function isUnlocked(): Promise<boolean> {
  if (!(await hasVault())) return false;

  const state = await readSession();
  if (!state) return false;

  const limit = await autoLockMs();
  if (limit > 0 && Date.now() - state.lastUsedAt > limit) {
    await lock();
    return false;
  }
  return true;
}

/**
 * Returns the data key, enforcing the idle lock first.
 *
 * Every code path that touches a stored credential goes through this, so the
 * auto-lock cannot be bypassed by calling a lower-level helper.
 */
export async function requireDataKey(): Promise<CryptoKey> {
  if (!(await hasVault())) {
    throw new FluidError(FluidErrorCode.Locked, "No wallet has been set up yet.");
  }

  const state = await readSession();
  if (!state) {
    throw new FluidError(FluidErrorCode.Locked, "The wallet is locked.");
  }

  const limit = await autoLockMs();
  if (limit > 0 && Date.now() - state.lastUsedAt > limit) {
    await lock();
    throw new FluidError(FluidErrorCode.Locked, "The wallet locked itself after inactivity.");
  }

  const key = await importDataKey(state.dataKey);
  const now = Date.now();
  memory = { key, lastUsedAt: now };
  await writeSession({ ...state, lastUsedAt: now });
  return key;
}

export async function sealString(plaintext: string): Promise<EncryptedSecret> {
  const [key, kdf] = await Promise.all([requireDataKey(), getSetting<StoredKdf>(KDF_SETTING)]);
  if (!kdf) throw new FluidError(FluidErrorCode.Locked, "No wallet has been set up yet.");
  return encryptString(key, plaintext, kdfToEnvelope(kdf));
}

export async function openString(secret: EncryptedSecret): Promise<string> {
  return decryptString(await requireDataKey(), secret);
}

export async function changePassword(current: string, next: string): Promise<void> {
  assertPassword(next);
  await unlock(current);

  const dataKey = await requireDataKey();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kdf: StoredKdf = { salt: toBase64(salt), iterations: DEFAULT_KDF_ITERATIONS };
  const kek = await deriveKey(next, salt, kdf.iterations);

  await setSetting(KDF_SETTING, kdf);
  await setSetting(WRAPPED_SETTING, await wrapDataKey(kek, dataKey, kdfToEnvelope(kdf)));
}

export async function setAutoLock(ms: number): Promise<void> {
  await setSetting(AUTO_LOCK_SETTING, ms);
}

export async function getAutoLock(): Promise<number> {
  return autoLockMs();
}

function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new FluidError(
      FluidErrorCode.InvalidParams,
      `The password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    );
  }
}

function kdfToEnvelope(kdf: StoredKdf): EncryptedSecret["kdf"] {
  return { name: "PBKDF2", hash: "SHA-256", iterations: kdf.iterations, salt: kdf.salt };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
