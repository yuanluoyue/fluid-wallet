import { describe, expect, it } from "vitest";

import {
  isAllowedProviderEndpoint,
  providerEndpointPath,
  providerPath,
  resolveProviderUrl,
} from "./url";

describe("providerPath", () => {
  it("drops a base prefix the page repeated", () => {
    expect(providerPath("https://api.deepseek.com/v1", "/v1/chat/completions")).toBe(
      "/chat/completions",
    );
  });

  it("keeps unrelated paths as they are", () => {
    expect(providerPath("https://api.deepseek.com/v1", "/chat/completions")).toBe(
      "/chat/completions",
    );
  });

  it("normalises a missing leading slash", () => {
    expect(providerPath("https://api.openai.com/v1", "models")).toBe("/models");
  });
});

describe("resolveProviderUrl", () => {
  it("keeps the page out of the host", () => {
    // The whole safety story of the raw proxy rests on this line: whatever the
    // page sends, the host is the one the user configured.
    const target = new URL(
      resolveProviderUrl("https://api.deepseek.com/v1", "https://evil.test/steal"),
    );
    expect(target.origin).toBe("https://api.deepseek.com");
  });

  it("builds a normal chat URL", () => {
    expect(resolveProviderUrl("https://api.deepseek.com/v1", "/chat/completions")).toBe(
      "https://api.deepseek.com/v1/chat/completions",
    );
  });
});

describe("providerEndpointPath", () => {
  it("strips the query string and trailing slashes", () => {
    expect(providerEndpointPath("https://api.openai.com/v1", "/models/?limit=5")).toBe("/models");
  });

  it("collapses duplicated slashes", () => {
    expect(providerEndpointPath("https://api.openai.com/v1", "//chat//completions")).toBe(
      "/chat/completions",
    );
  });
});

describe("isAllowedProviderEndpoint", () => {
  const base = "https://api.deepseek.com/v1";

  it("allows the calls a chat client actually makes", () => {
    expect(isAllowedProviderEndpoint(base, "/chat/completions")).toBe(true);
    expect(isAllowedProviderEndpoint(base, "/v1/chat/completions")).toBe(true);
    expect(isAllowedProviderEndpoint(base, "/models", "GET")).toBe(true);
  });

  it("refuses endpoints that are not part of the chat surface", () => {
    expect(isAllowedProviderEndpoint(base, "/user/balance", "GET")).toBe(false);
    expect(isAllowedProviderEndpoint(base, "/files", "POST")).toBe(false);
    expect(isAllowedProviderEndpoint(base, "/fine_tuning/jobs", "POST")).toBe(false);
  });

  it("refuses a verb the endpoint does not take", () => {
    expect(isAllowedProviderEndpoint(base, "/chat/completions", "GET")).toBe(false);
    expect(isAllowedProviderEndpoint(base, "/models", "POST")).toBe(false);
  });

  it("refuses traversal instead of normalising it", () => {
    expect(isAllowedProviderEndpoint(base, "/../user/balance", "GET")).toBe(false);
    expect(isAllowedProviderEndpoint(base, "/chat/../user/balance", "POST")).toBe(false);
  });
});
