import { describe, expect, it } from "vitest";

import {
  FluidError,
  FluidErrorCode,
  FLUID_LIMITS,
  parseEvent,
  parseInferenceParams,
  parseProxyParams,
  parseRequest,
  parseResponse,
  providerPath,
  resolveProviderUrl,
} from "./index";

describe("parseRequest", () => {
  it("accepts a well-formed envelope", () => {
    const parsed = parseRequest({ jsonrpc: "2.0", id: "req-1", method: "wallet.getInfo" });
    expect(parsed.ok).toBe(true);
  });

  it("rejects a missing jsonrpc version", () => {
    const parsed = parseRequest({ id: "req-1", method: "wallet.getInfo" });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe(FluidErrorCode.InvalidParams);
  });

  it("rejects params that are not an object", () => {
    const parsed = parseRequest({ jsonrpc: "2.0", id: "req-1", method: "x", params: [1, 2] });
    expect(parsed.ok).toBe(false);
  });
});

describe("parseResponse", () => {
  it("requires exactly one of result or error", () => {
    expect(parseResponse({ jsonrpc: "2.0", id: "1", result: {} }).ok).toBe(true);
    expect(parseResponse({ jsonrpc: "2.0", id: "1" }).ok).toBe(false);
    expect(
      parseResponse({ jsonrpc: "2.0", id: "1", result: {}, error: { code: 1, message: "x" } }).ok,
    ).toBe(false);
  });
});

describe("parseEvent", () => {
  it("requires a type and a payload", () => {
    expect(parseEvent({ type: "inference.delta", payload: { text: "a" } }).ok).toBe(true);
    expect(parseEvent({ type: "inference.delta" }).ok).toBe(false);
  });
});

describe("parseInferenceParams", () => {
  const base = {
    sessionId: "s-1",
    messages: [{ role: "user", content: "hi" }],
  };

  it("accepts a minimal request", () => {
    const parsed = parseInferenceParams(base);
    expect(parsed.ok).toBe(true);
  });

  it("rejects an empty message list", () => {
    const parsed = parseInferenceParams({ ...base, messages: [] });
    expect(parsed.ok).toBe(false);
  });

  it("rejects more tools than the protocol allows", () => {
    const tools = Array.from({ length: FLUID_LIMITS.maxTools + 1 }, (_, index) => ({
      name: `tool_${index}`,
      parameters: { type: "object" },
    }));
    const parsed = parseInferenceParams({ ...base, tools });
    expect(parsed.ok).toBe(false);
  });

  it("rejects a tool without a JSON Schema", () => {
    const parsed = parseInferenceParams({ ...base, tools: [{ name: "noop" }] });
    expect(parsed.ok).toBe(false);
  });
});

describe("parseProxyParams", () => {
  const base = { sessionId: "s-1", path: "/v1/chat/completions" };

  it("accepts a minimal request", () => {
    expect(parseProxyParams(base).ok).toBe(true);
  });

  it("rejects a relative or absolute URL path", () => {
    expect(parseProxyParams({ ...base, path: "v1/chat" }).ok).toBe(false);
    expect(parseProxyParams({ ...base, path: "https://evil.example/v1" }).ok).toBe(false);
  });

  it("rejects traversal and scheme smuggling", () => {
    for (const path of ["/../etc/passwd", "/v1/../admin", "/v1\\..\\x", "/a://b"]) {
      expect(parseProxyParams({ ...base, path }).ok).toBe(false);
    }
  });

  it("rejects a path that starts with a double slash", () => {
    expect(parseProxyParams({ ...base, path: "//evil.example/v1" }).ok).toBe(false);
  });

  it("only allows the page to set accept", () => {
    expect(parseProxyParams({ ...base, headers: { accept: "text/event-stream" } }).ok).toBe(true);
    expect(parseProxyParams({ ...base, headers: { authorization: "Bearer x" } }).ok).toBe(false);
  });

  it("bounds the body size", () => {
    const body = "x".repeat(FLUID_LIMITS.maxProxyBodyBytes + 1);
    expect(parseProxyParams({ ...base, body }).ok).toBe(false);
  });

  it("rejects unsupported methods", () => {
    expect(parseProxyParams({ ...base, method: "DELETE" }).ok).toBe(false);
  });
});

describe("resolveProviderUrl", () => {
  const base = "https://api.deepseek.com/v1";

  it("keeps the provider prefix exactly once", () => {
    expect(resolveProviderUrl(base, "/v1/chat/completions")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(resolveProviderUrl(base, "/chat/completions")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
    expect(resolveProviderUrl("https://api.deepseek.com/v1/", "/v1/models")).toBe(
      "https://api.deepseek.com/v1/models",
    );
  });

  it("works when the base URL has no prefix", () => {
    expect(resolveProviderUrl("https://api.deepseek.com", "/v1/models")).toBe(
      "https://api.deepseek.com/v1/models",
    );
  });

  it("never lets the page change the host", () => {
    expect(resolveProviderUrl(base, "/v1/chat/completions")).toContain("api.deepseek.com");
    expect(providerPath(base, "/v1/user/balance")).toBe("/user/balance");
  });

  it("preserves query strings", () => {
    expect(resolveProviderUrl(base, "/v1/models?limit=5")).toBe(
      "https://api.deepseek.com/v1/models?limit=5",
    );
  });
});

describe("FluidError", () => {
  it("serialises to a wire-safe shape", () => {
    const error = new FluidError(FluidErrorCode.PermissionDenied, "nope");
    expect(error.toJSON()).toEqual({ code: FluidErrorCode.PermissionDenied, message: "nope" });
    expect(FluidError.from(error.toJSON())).toBeInstanceOf(FluidError);
  });
});
