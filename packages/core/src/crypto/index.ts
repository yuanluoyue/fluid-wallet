/**
 * Local key vault primitives.
 *
 * The threat model is deliberately narrow: an attacker who can read the
 * extension's storage should not be able to read the user's API keys without
 * also knowing the unlock password. This does not protect against malware
 * running with the user's privileges, and it must never be exposed to web
 * pages — decryption only happens inside the trusted runtime.
 */

/** Versioned envelope so the KDF parameters can be upgraded without losing data. */
export interface EncryptedSecret {
  version: 1;
  algorithm: "AES-GCM";
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  iv: string;
  ciphertext: string;
}

export const DEFAULT_KDF_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  crypto.getRandomValues(bytes);
  return bytes;
}

function toBase64(bytes: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function generateSalt(): Uint8Array<ArrayBuffer> {
  return randomBytes(SALT_BYTES);
}

/** Derives a non-extractable AES-GCM key from the unlock password. */
export async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number = DEFAULT_KDF_ITERATIONS,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Generates the long-lived data key that actually protects stored secrets.
 *
 * Records are encrypted with a data key rather than with the password-derived
 * key directly: changing the master password then only rewraps one small blob
 * instead of re-encrypting every credential the user ever saved.
 */
export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportDataKey(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importDataKey(raw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromBase64(raw), { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/** Seals the data key under the password-derived key. */
export async function wrapDataKey(
  kek: CryptoKey,
  dataKey: CryptoKey,
  kdf: EncryptedSecret["kdf"],
): Promise<EncryptedSecret> {
  return encryptString(kek, await exportDataKey(dataKey), kdf);
}

export async function unwrapDataKey(kek: CryptoKey, wrapped: EncryptedSecret): Promise<CryptoKey> {
  return importDataKey(await decryptString(kek, wrapped));
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string,
  kdf: EncryptedSecret["kdf"],
): Promise<EncryptedSecret> {
  const iv = randomBytes(IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plaintext),
  );

  return {
    version: 1,
    algorithm: "AES-GCM",
    kdf,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptString(key: CryptoKey, secret: EncryptedSecret): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(secret.iv) },
    key,
    fromBase64(secret.ciphertext),
  );
  return decoder.decode(plaintext);
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  kdf: EncryptedSecret["kdf"],
): Promise<EncryptedSecret> {
  return encryptString(key, JSON.stringify(value), kdf);
}

export async function decryptJson<T>(key: CryptoKey, secret: EncryptedSecret): Promise<T> {
  return JSON.parse(await decryptString(key, secret)) as T;
}

/**
 * In-memory holder for the derived key.
 *
 * Locking drops the key reference; nothing is written back to storage, and the
 * password itself is never retained.
 */
export class SecretVault {
  #key: CryptoKey | null = null;
  #kdf: EncryptedSecret["kdf"] | null = null;

  get locked(): boolean {
    return this.#key === null;
  }

  get kdfParameters(): EncryptedSecret["kdf"] | null {
    return this.#kdf;
  }

  /**
   * Unlocks the vault.
   *
   * Pass an existing salt when reopening a wallet that already has secrets;
   * omit it the first time so a fresh salt is generated and returned.
   */
  async unlock(
    password: string,
    existing?: { salt: string; iterations: number },
    iterations: number = DEFAULT_KDF_ITERATIONS,
  ): Promise<EncryptedSecret["kdf"]> {
    const salt = existing ? fromBase64(existing.salt) : generateSalt();
    const kdf: EncryptedSecret["kdf"] = {
      name: "PBKDF2",
      hash: "SHA-256",
      iterations: existing?.iterations ?? iterations,
      salt: toBase64(salt),
    };

    this.#key = await deriveKey(password, salt, kdf.iterations);
    this.#kdf = kdf;
    return kdf;
  }

  lock(): void {
    this.#key = null;
  }

  #requireKey(): CryptoKey {
    if (!this.#key) throw new Error("The vault is locked.");
    return this.#key;
  }

  async seal(value: unknown): Promise<EncryptedSecret> {
    if (!this.#kdf) throw new Error("The vault is locked.");
    return encryptJson(this.#requireKey(), value, this.#kdf);
  }

  async open<T>(secret: EncryptedSecret): Promise<T> {
    return decryptJson<T>(this.#requireKey(), secret);
  }
}

// ---------------------------------------------------------------------------
// Portable encrypted files
// ---------------------------------------------------------------------------

/** Envelope for a file the user may store outside the wallet. */
export interface SealedFile {
  format: string;
  version: 1;
  createdAt: number;
  secret: EncryptedSecret;
}

/**
 * Seals an arbitrary payload into a self-contained, passphrase-protected file.
 *
 * The point of a portable file is that it must be openable without the wallet
 * that wrote it, so the KDF parameters travel with the ciphertext instead of
 * being looked up from local storage. The passphrase is deliberately separate
 * from the master password: a backup that only works on the machine it came
 * from is not a backup.
 */
export async function sealFile(options: {
  format: string;
  value: unknown;
  passphrase: string;
  iterations?: number;
}): Promise<string> {
  if (options.passphrase.length < 8) {
    throw new Error("A backup passphrase must be at least 8 characters long.");
  }

  const salt = generateSalt();
  const iterations = options.iterations ?? DEFAULT_KDF_ITERATIONS;
  const kdf: EncryptedSecret["kdf"] = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations,
    salt: toBase64(salt),
  };

  const key = await deriveKey(options.passphrase, salt, iterations);
  const file: SealedFile = {
    format: options.format,
    version: 1,
    createdAt: Date.now(),
    secret: await encryptJson(key, options.value, kdf),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Opens a file written by `sealFile`.
 *
 * Every failure — wrong passphrase, truncated file, edited ciphertext — lands
 * on the same message on purpose: telling them apart would help someone
 * attacking the file more than it helps the person who forgot a password.
 */
export async function openFile<T>(
  text: string,
  passphrase: string,
  expectedFormat?: string,
): Promise<T> {
  let file: SealedFile;
  try {
    file = JSON.parse(text) as SealedFile;
  } catch {
    throw new Error("That file is not a Fluid Wallet backup.");
  }

  if (
    typeof file !== "object" ||
    file === null ||
    file.version !== 1 ||
    typeof file.format !== "string" ||
    typeof file.secret?.ciphertext !== "string" ||
    typeof file.secret?.kdf?.salt !== "string"
  ) {
    throw new Error("That file is not a Fluid Wallet backup.");
  }
  if (expectedFormat && file.format !== expectedFormat) {
    throw new Error(`Expected a "${expectedFormat}" file, found "${file.format}".`);
  }

  const { kdf } = file.secret;
  const key = await deriveKey(passphrase, fromBase64(kdf.salt), kdf.iterations);
  try {
    return await decryptJson<T>(key, file.secret);
  } catch {
    throw new Error("Could not open the backup: wrong passphrase, or the file was modified.");
  }
}
