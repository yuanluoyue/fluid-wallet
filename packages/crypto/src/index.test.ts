import { describe, expect, it } from "vitest";

import { SecretVault } from "./index";

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
