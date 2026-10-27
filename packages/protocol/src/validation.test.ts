import { describe, expect, it } from "vitest";

import {
  FluidError,
  FluidErrorCode,
  FLUID_LIMITS,
  parseEvent,
  parseInferenceParams,
  parseRequest,
  parseResponse,
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

describe("FluidError", () => {
  it("serialises to a wire-safe shape", () => {
    const error = new FluidError(FluidErrorCode.PermissionDenied, "nope");
    expect(error.toJSON()).toEqual({ code: FluidErrorCode.PermissionDenied, message: "nope" });
    expect(FluidError.from(error.toJSON())).toBeInstanceOf(FluidError);
  });
});
