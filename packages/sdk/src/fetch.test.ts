import { FLUID_EVENTS, FluidError, FluidErrorCode, FluidMethod } from "@fluid-wallet/protocol";
import { createMockWallet } from "./testing";
import { describe, expect, it } from "vitest";

import { connectFluid, createDevFetch } from "./connect";
import { FluidClient } from "./client";
import { createFluidFetch } from "./fetch";
import { BridgeTransport } from "./transport";

const DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions";

function setup(options: Parameters<typeof createMockWallet>[0] = {}) {
  const wallet = createMockWallet(options);
  const client = new FluidClient({ transport: new BridgeTransport(wallet) });
  return { wallet, client };
}

async function connected(options: Parameters<typeof createMockWallet>[0] = {}) {
  const context = setup(options);
  await context.client.connect({
    capabilities: ["wallet:read", "models:list", "inference:text", "inference:proxy"],
  });
  const session = await context.client.createSession({ model: "deepseek-chat" });
  return { ...context, sessionId: session.id };
}

describe("createFluidFetch", () => {
  it("returns a Response with the provider status and reassembled body", async () => {
    const { client, sessionId } = await connected();
    const fluidFetch = createFluidFetch(client, { sessionId, providerId: "deepseek" });

    const response = await fluidFetch(DEEPSEEK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "deepseek-chat", messages: [] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");

    const body = (await response.json()) as { path: string; method: string; body: string };
    expect(body.path).toBe("/v1/chat/completions");
    expect(body.method).toBe("POST");
    // The wallet never sees a host from the page, only the path.
    expect(body.body).toContain("deepseek-chat");
  });

  it("passes provider error statuses through instead of mapping them", async () => {
    const { client, sessionId } = await connected({
      proxy: () => ({
        status: 401,
        contentType: "application/json",
        body: '{"error":{"message":"invalid key"}}',
      }),
    });
    const fluidFetch = createFluidFetch(client, { sessionId });

    const response = await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });

    expect(response.status).toBe(401);
    expect(await response.text()).toBe('{"error":{"message":"invalid key"}}');
  });

  it("streams an SSE body incrementally", async () => {
    const frames = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const { client, sessionId } = await connected({
      proxy: () => ({ status: 200, contentType: "text/event-stream", body: frames.join("") }),
    });
    const fluidFetch = createFluidFetch(client, { sessionId });

    const response = await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const seen: string[] = [];
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      seen.push(decoder.decode(value, { stream: true }));
    }

    expect(seen.length).toBeGreaterThan(1);
    expect(seen.join("")).toBe(frames.join(""));
  });

  it("rejects before returning a Response when the wallet refuses the request", async () => {
    const { client, wallet } = setup();
    await client.connect();
    const session = await client.createSession();
    // The user revoked the grant between the app opening and the first call.
    wallet.state.permissions.clear();

    const fluidFetch = createFluidFetch(client, { sessionId: session.id });

    await expect(fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" })).rejects.toMatchObject({
      code: FluidErrorCode.PermissionDenied,
    });
  });

  it("forwards the path only, never the host", async () => {
    const { client, wallet, sessionId } = await connected();
    const fluidFetch = createFluidFetch(client, { sessionId });

    await fluidFetch("https://attacker.example/v1/chat/completions?x=1", {
      method: "POST",
      body: "{}",
    });

    const call = wallet.calls.find((entry) => entry.method === "inference.proxy");
    expect((call?.params as { path: string }).path).toBe("/v1/chat/completions?x=1");
  });
});

describe("connectFluid", () => {
  it("returns a wallet handle when the wallet answers", async () => {
    const wallet = createMockWallet();
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });

    const handle = await connectFluid({ client, providerId: "deepseek", appName: "Test app" });
    expect(handle.mode).toBe("wallet");
    expect(handle.sessionId).toBeTruthy();

    const response = await handle.createFetch()(DEEPSEEK_URL, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
  });

  it("falls back to a direct fetch in development", async () => {
    const wallet = createMockWallet();
    wallet.request = async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: FluidErrorCode.Timeout, message: "No wallet is listening." },
    });
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const devFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const handle = await connectFluid({
      client,
      devApiKey: "sk-test",
      devFetch,
      devBaseUrl: "https://api.deepseek.com/v1",
    });

    expect(handle.mode).toBe("dev");
    const response = await handle.createFetch()(DEEPSEEK_URL, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(calls[0]?.url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect((calls[0]?.init?.headers as Headers).get("authorization")).toBe("Bearer sk-test");
  });

  it("refuses the development fallback without a key", async () => {
    const wallet = createMockWallet();
    wallet.request = async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: FluidErrorCode.Timeout, message: "No wallet is listening." },
    });
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });

    await expect(connectFluid({ client })).rejects.toBeInstanceOf(FluidError);
  });
});

describe("createDevFetch", () => {
  it("keeps the provider prefix exactly once", async () => {
    const seen: string[] = [];
    const devFetch = (async (url: string) => {
      seen.push(url);
      return new Response("{}");
    }) as unknown as typeof fetch;

    const fluidFetch = createDevFetch({
      apiKey: "sk-test",
      baseUrl: "https://api.deepseek.com/v1",
      fetchImpl: devFetch,
    });

    await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });
    await fluidFetch("https://api.deepseek.com/chat/completions", { method: "POST", body: "{}" });

    expect(seen).toEqual([
      "https://api.deepseek.com/v1/chat/completions",
      "https://api.deepseek.com/v1/chat/completions",
    ]);
  });

  it("rejects body types it cannot carry", async () => {
    const fluidFetch = createFluidFetch(
      new FluidClient({ transport: new BridgeTransport(createMockWallet()) }),
      { sessionId: "s1" },
    );

    await expect(
      fluidFetch(DEEPSEEK_URL, { method: "POST", body: new FormData() }),
    ).rejects.toMatchObject({ code: FluidErrorCode.InvalidParams });
  });
});

describe("createFluidFetch resilience", () => {
  it("carries the provider's response headers, not just the content type", async () => {
    // A 429 without `retry-after` is a 429 every client has to guess about. The
    // AI SDK reads that header to decide how long to wait; losing it turns a
    // backoff into a hard failure in the middle of a multi-step agent run.
    const { client, sessionId } = await connected({
      proxy: () => ({
        status: 429,
        contentType: "application/json",
        body: '{"error":"slow down"}',
        headers: {
          "retry-after": "7",
          "x-ratelimit-remaining-requests": "0",
          // Filters that belong to the wallet's own wire format, not the page's.
          "content-encoding": "gzip",
          "content-length": "21",
          "set-cookie": "session=abc",
        },
      }),
    });
    const fluidFetch = createFluidFetch(client, { sessionId });

    const response = await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("x-ratelimit-remaining-requests")).toBe("0");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("sends the headers a provider SDK negotiates with, and nothing else", async () => {
    const { client, wallet, sessionId } = await connected();
    const fluidFetch = createFluidFetch(client, { sessionId });

    await fluidFetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "anthropic-version": "2023-06-01",
        // Never forwarded: the credential and the connection belong to the wallet.
        authorization: "Bearer sk-page-owns-this",
        "x-api-key": "sk-page-owns-this",
        cookie: "session=abc",
      },
      body: "{}",
    });

    const call = wallet.calls.find((entry) => entry.method === FluidMethod.InferenceProxy);
    expect((call?.params as { headers?: Record<string, string> }).headers).toEqual({
      accept: "text/event-stream",
      "content-type": "application/json",
      "anthropic-version": "2023-06-01",
    });
  });

  it("turns a truncated body into an error instead of a short answer", async () => {
    // The wallet stops the stream when the user interrupts. Ending cleanly would
    // hand a half-finished message to the caller as a complete one.
    const { client, sessionId } = await connected({
      proxy: () => ({
        status: 200,
        contentType: "text/event-stream",
        body: 'data: {"choices":[{"delta":{"content":"半',
        truncated: true,
      }),
    });
    const fluidFetch = createFluidFetch(client, { sessionId });

    const response = await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);

    await expect(response.text()).rejects.toMatchObject({
      code: FluidErrorCode.InferenceCancelled,
    });
  });

  it("gives up on a silent stream instead of leaving it open forever", async () => {
    // What a reloaded tab looks like from the page: the head arrives, then
    // nothing, because the only thing that could send the rest is gone. Without
    // a deadline the ReadableStream never closes and the UI spins forever.
    const { client, wallet, sessionId } = await connected();
    const original = wallet.request.bind(wallet);
    wallet.request = async (message) => {
      if (message.method !== FluidMethod.InferenceProxy) return original(message);

      wallet.emit({
        type: FLUID_EVENTS.ProxyStart,
        requestId: message.id,
        payload: { proxyId: message.id, status: 200, contentType: "text/event-stream" },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      return {
        jsonrpc: "2.0" as const,
        id: message.id,
        result: { status: 200, contentType: "text/event-stream", bytes: 0 },
      };
    };

    const fluidFetch = createFluidFetch(client, { sessionId, idleTimeoutMs: 20 });
    const response = await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });

    await expect(response.text()).rejects.toMatchObject({ code: FluidErrorCode.Timeout });
  });

  it("rebuilds the session once when the wallet has forgotten it", async () => {
    // The extension updated, or the wallet dropped the session while idle. Every
    // later call would fail with the same expired id; one retry against a fresh
    // session is what turns that into a hiccup instead of a dead page.
    const { client, wallet, sessionId } = await connected();
    const original = wallet.request.bind(wallet);
    let proxies = 0;
    wallet.request = async (message) => {
      if (message.method === FluidMethod.InferenceProxy && proxies++ === 0) {
        return {
          jsonrpc: "2.0" as const,
          id: message.id,
          error: { code: FluidErrorCode.SessionExpired, message: "Session is no longer active." },
        };
      }
      return original(message);
    };

    const recovered: string[] = [];
    const fluidFetch = createFluidFetch(client, {
      sessionId,
      recoverSession: async () => {
        const next = await client.createSession();
        recovered.push(next.id);
        return next.id;
      },
    });

    const response = await fluidFetch(DEEPSEEK_URL, { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).not.toBe(sessionId);
  });
});
