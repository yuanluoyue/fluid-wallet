import { describe, expect, it } from "vitest";

import {
  DEFAULT_KDF_ITERATIONS,
  SecretVault,
  decryptString,
  deriveKey,
  encryptString,
  exportDataKey,
  generateDataKey,
  generateSalt,
  importDataKey,
  unwrapDataKey,
  wrapDataKey,
} from "./index";

const KDF = {
  name: "PBKDF2" as const,
  hash: "SHA-256" as const,
  iterations: DEFAULT_KDF_ITERATIONS,
  salt: "",
};

describe("data key wrapping", () => {
  it("wraps and unwraps the data key with the password-derived key", async () => {
    const salt = generateSalt();
    const kek = await deriveKey("master-password", salt, 1_000);
    const dataKey = await generateDataKey();

    const wrapped = await wrapDataKey(kek, dataKey, { ...KDF, salt: "ignored" });
    const raw = await exportDataKey(dataKey);
    expect(wrapped.ciphertext).not.toContain(raw);

    const restored = await unwrapDataKey(kek, wrapped);
    expect(await exportDataKey(restored)).toBe(raw);

    const sealed = await encryptString(restored, "sk-live-key", { ...KDF, salt: "ignored" });
    expect(await decryptString(dataKey, sealed)).toBe("sk-live-key");
  });

  it("fails to unwrap with a different password", async () => {
    const salt = generateSalt();
    const dataKey = await generateDataKey();
    const wrapped = await wrapDataKey(
      await deriveKey("right", salt, 1_000),
      dataKey,
      { ...KDF, salt: "ignored" },
    );

    await expect(unwrapDataKey(await deriveKey("wrong", salt, 1_000), wrapped)).rejects.toThrow();
  });

  it("round-trips a raw key through export and import", async () => {
    const dataKey = await generateDataKey();
    const raw = await exportDataKey(dataKey);
    expect(await exportDataKey(await importDataKey(raw))).toBe(raw);
  });
});

describe("SecretVault", () => {
  it("seals and reopens a secret without leaking plaintext", async () => {
    const vault = new SecretVault();
    await vault.unlock("correct horse battery staple", undefined, 1_000);

    const sealed = await vault.seal({ apiKey: "sk-test-key" });
    expect(sealed.algorithm).toBe("AES-GCM");
    expect(sealed.ciphertext).not.toContain("sk-test-key");
    expect(await vault.open(sealed)).toEqual({ apiKey: "sk-test-key" });
  });

  it("refuses to decrypt with the wrong password", async () => {
    const vault = new SecretVault();
    const kdf = await vault.unlock("right-password", undefined, 1_000);
    const sealed = await vault.seal("sk-secret");

    const attacker = new SecretVault();
    await attacker.unlock("wrong-password", kdf);

    await expect(attacker.open(sealed)).rejects.toThrow();
  });

  it("cannot seal while locked", async () => {
    const vault = new SecretVault();
    await vault.unlock("password", undefined, 1_000);
    vault.lock();

    expect(vault.locked).toBe(true);
    await expect(vault.seal("x")).rejects.toThrow(/locked/i);
  });
});
