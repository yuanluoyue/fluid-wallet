import { FluidErrorCode } from "@fluid-wallet/protocol";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRANT_TTL_MS,
  PermissionStore,
  RateLimiter,
  RequestBudget,
  SessionRegistry,
  type BudgetStore,
} from "./index";

/** In-memory stand-in for the Dexie-backed counter. */
function memoryBudgetStore(): BudgetStore {
  const rows = new Map<string, { requests: number }>();
  return {
    async read(day, origin) {
      return rows.get(`${day}:${origin}`);
    },
    async write(day, origin, value) {
      rows.set(`${day}:${origin}`, value);
    },
  };
}

describe("PermissionStore", () => {
  it("refuses capabilities that must stay inside the wallet", () => {
    const store = new PermissionStore();

    expect(() => store.grant("https://app.test", { capabilities: ["wallet:manage"] })).toThrow(
      expect.objectContaining({ code: FluidErrorCode.PermissionDenied }),
    );
  });

  it("enforces the capability a method declares", () => {
    const store = new PermissionStore();
    store.grant("https://app.test", { capabilities: ["inference:text"] });

    expect(() => store.checkMethod("model.list", "https://app.test")).toThrow(
      expect.objectContaining({ code: FluidErrorCode.PermissionDenied }),
    );
    expect(store.checkMethod("inference.create", "https://app.test").origin).toBe(
      "https://app.test",
    );
  });

  it("expires a grant after its TTL", () => {
    let now = 1_000;
    const store = new PermissionStore(() => now);
    store.grant("https://app.test", { capabilities: ["models:list"] });

    now += DEFAULT_GRANT_TTL_MS + 1;
    expect(store.get("https://app.test")).toBeNull();
    expect(() => store.checkMethod("model.list", "https://app.test")).toThrow(
      expect.objectContaining({ code: FluidErrorCode.Unauthorized }),
    );
  });

  it("never lets one origin use another origin's grant", () => {
    const store = new PermissionStore();
    store.grant("https://app.test", { capabilities: ["inference:text"] });

    expect(() => store.checkMethod("inference.create", "https://evil.test")).toThrow(
      expect.objectContaining({ code: FluidErrorCode.Unauthorized }),
    );
  });

  it("grants without an expiry when the user says always", () => {
    const store = new PermissionStore();
    const permission = store.grant(
      "https://app.test",
      { capabilities: ["inference:text"] },
      {
        ttlMs: null,
      },
    );

    expect(permission.expiresAt).toBeUndefined();
  });

  it("defaults to a week rather than forever", () => {
    const store = new PermissionStore(() => 1_000);
    const permission = store.grant("https://app.test", { capabilities: ["inference:text"] });

    expect(permission.expiresAt).toBe(1_000 + DEFAULT_GRANT_TTL_MS);
  });
});

describe("SessionRegistry", () => {
  it("rejects a session owned by a different origin", () => {
    const registry = new SessionRegistry();
    const session = registry.create("https://app.test", { model: "deepseek-chat" });

    expect(() => registry.requireOwned(session.id, "https://evil.test")).toThrow(
      expect.objectContaining({ code: FluidErrorCode.PermissionDenied }),
    );
    expect(registry.requireOwned(session.id, "https://app.test").id).toBe(session.id);
  });

  it("refuses closed sessions", () => {
    const registry = new SessionRegistry();
    const session = registry.create("https://app.test");

    registry.close(session.id);
    expect(() => registry.get(session.id)).toThrow(
      expect.objectContaining({ code: FluidErrorCode.SessionExpired }),
    );
  });
});

describe("RateLimiter", () => {
  it("throws once the window is exhausted", () => {
    const limiter = new RateLimiter(2, 60_000, () => 0);

    limiter.consume("https://app.test");
    limiter.consume("https://app.test");

    expect(() => limiter.consume("https://app.test")).toThrow(
      expect.objectContaining({ code: FluidErrorCode.RateLimited }),
    );
  });
});

describe("RequestBudget", () => {
  it("refuses the request that would exceed the day's limit", async () => {
    const budget = new RequestBudget(memoryBudgetStore(), () => Date.UTC(2026, 9, 27, 12));

    await budget.consume("https://app.test", 2);
    await budget.consume("https://app.test", 2);

    await expect(budget.consume("https://app.test", 2)).rejects.toMatchObject({
      code: FluidErrorCode.BudgetExceeded,
    });
  });

  it("counts separately per origin", async () => {
    const budget = new RequestBudget(memoryBudgetStore(), () => 0);

    await budget.consume("https://a.test", 1);
    await expect(budget.consume("https://b.test", 1)).resolves.toMatchObject({ used: 1 });
  });

  it("resets when the UTC day rolls over", async () => {
    let now = Date.UTC(2026, 9, 27, 23, 59);
    const budget = new RequestBudget(memoryBudgetStore(), () => now);

    await budget.consume("https://app.test", 1);
    now += 2 * 60_000;

    expect(await budget.usage("https://app.test", 1)).toMatchObject({ used: 0, day: "2026-10-28" });
    await expect(budget.consume("https://app.test", 1)).resolves.toMatchObject({ used: 1 });
  });

  it("treats zero as unlimited", async () => {
    const budget = new RequestBudget(memoryBudgetStore(), () => 0);

    for (let index = 0; index < 5; index += 1) {
      await expect(budget.consume("https://app.test", 0)).resolves.toBeTruthy();
    }
  });
});
