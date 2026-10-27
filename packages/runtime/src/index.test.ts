import { FluidErrorCode } from "@fluid-wallet/protocol";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRANT_TTL_MS,
  PermissionStore,
  RateLimiter,
  SessionRegistry,
} from "./index";

describe("PermissionStore", () => {
  it("refuses capabilities that must stay inside the wallet", () => {
    const store = new PermissionStore();

    expect(() =>
      store.grant("https://app.test", { capabilities: ["wallet:manage"] }),
    ).toThrow(expect.objectContaining({ code: FluidErrorCode.PermissionDenied }));
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
