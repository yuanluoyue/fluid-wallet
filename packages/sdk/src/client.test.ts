import { FLUID_EVENTS, FluidError, FluidErrorCode } from "@fluid-wallet/protocol";
import { createMockWallet } from "./testing";
import { describe, expect, it } from "vitest";

import { FluidClient } from "./client";
import { BridgeTransport } from "./transport";

function setup(options: Parameters<typeof createMockWallet>[0] = {}) {
  const wallet = createMockWallet(options);
  const client = new FluidClient({
    transport: new BridgeTransport(wallet),
    appId: "test-app",
    appName: "Test app",
  });
  return { wallet, client };
}

describe("FluidClient", () => {
  it("detects an available wallet", async () => {
    const { client } = setup();
    const info = await client.detect();

    expect(info?.name).toBe("Mock Fluid Wallet");
    expect(client.state.availability).toBe("available");
  });

  it("returns null when no wallet answers", async () => {
    const wallet = createMockWallet();
    wallet.request = async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: FluidErrorCode.Timeout, message: "No wallet is listening." },
    });
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });

    const info = await client.detect();
    expect(info).toBeNull();
    expect(client.state.availability).toBe("unavailable");
  });

  it("blames the caller, not the wallet, when the client was disposed", async () => {
    // A client thrown away by a re-mounted React effect answers nothing, and
    // used to report `NotInstalled`: the page went looking for a missing
    // extension while the extension was answering other tabs fine.
    const { client } = setup();
    client.dispose();

    await expect(client.detect()).rejects.toMatchObject({
      code: FluidErrorCode.InternalError,
    });
    expect(client.disposed).toBe(true);
  });

  it("connects and tracks authorization separately from connection", async () => {
    const { client } = setup();
    const permission = await client.connect();

    expect(permission.origin).toBe("https://mock.app");
    expect(permission.capabilities).toContain("inference:text");
    expect(client.state.connection).toBe("connected");
    expect(client.state.authorization).toBe("granted");
  });

  it("marks authorization as denied when the user rejects", async () => {
    const { client } = setup({ permissionMode: "deny" });

    await expect(client.connect()).rejects.toBeInstanceOf(FluidError);
    expect(client.state.connection).toBe("disconnected");
    expect(client.state.authorization).toBe("denied");
  });

  it("flags an expired grant", async () => {
    const { client } = setup({ permissionMode: "expired" });
    await client.connect();

    expect(client.state.authorization).toBe("expired");
  });

  it("creates a session scoped to the origin", async () => {
    const { client } = setup();
    await client.connect();

    const session = await client.createSession({ model: "deepseek-chat" });
    expect(session.origin).toBe("https://mock.app");
    expect(client.state.session?.id).toBe(session.id);
  });

  it("streams deltas and resolves the final result", async () => {
    const { client } = setup({ reply: () => "hello from the mock wallet", chunkDelayMs: 1 });
    await client.connect();
    const session = await client.createSession();

    const handle = client.createInference({
      sessionId: session.id,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });

    let text = "";
    for await (const event of handle.events) {
      if (event.type === FLUID_EVENTS.InferenceDelta) {
        text += (event.payload as { text: string }).text;
      }
    }

    const result = await handle.completed;
    expect(text).toBe("hello from the mock wallet");
    expect(result.finishReason).toBe("stop");
    expect(client.state.inference[handle.requestId]?.status).toBe("done");
  });

  it("refuses inference before a permission is granted", async () => {
    const { client } = setup();
    const handle = client.createInference({
      sessionId: "missing",
      messages: [{ role: "user", content: "hi" }],
    });

    await expect(handle.completed).rejects.toMatchObject({
      code: FluidErrorCode.PermissionDenied,
    });
  });

  it("revokes the grant and drops local permission state", async () => {
    const { client } = setup();
    await client.connect();

    const revoked = await client.revoke();
    expect(revoked).toBe(true);
    expect(client.state.permission).toBeNull();
    expect(client.state.authorization).toBe("denied");
  });

  it("closes a session", async () => {
    const { client } = setup();
    await client.connect();
    const session = await client.createSession();

    await client.closeSession();
    expect(client.state.session).toBeNull();
    await expect(client.closeSession(session.id)).rejects.toBeInstanceOf(FluidError);
  });

  it("reads today's budget for the origin", async () => {
    const { client } = setup({
      usage: { used: 12, limit: 300, day: "2026-10-27", resetsAt: 1_800_000 },
    });
    await client.connect();

    await expect(client.usage()).resolves.toMatchObject({ used: 12, limit: 300 });
  });

  it("treats an unknown usage method as 'no counter', not an error", async () => {
    const wallet = createMockWallet();
    const request = wallet.request.bind(wallet);
    wallet.request = async (message) =>
      message.method === "usage.get"
        ? {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: FluidErrorCode.MethodNotFound, message: "Not in this wallet." },
          }
        : request(message);

    const client = new FluidClient({ transport: new BridgeTransport(wallet) });
    await client.connect();

    await expect(client.usage()).resolves.toBeNull();
  });
});

describe("FluidClient under long sessions", () => {
  it("does not call a missing wallet a refusal", async () => {
    // A wallet that never answers is not a user who said no. Reporting "denied"
    // for a prompt that never appeared sends people looking for a decision
    // nobody made, while the actual problem is that nothing is listening.
    const wallet = createMockWallet();
    wallet.request = async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: FluidErrorCode.Timeout, message: "No wallet is listening." },
    });
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });

    await expect(client.connect()).rejects.toBeInstanceOf(FluidError);
    expect(client.state.connection).toBe("disconnected");
    expect(client.state.authorization).toBe("unknown");
  });

  it("still calls a refusal a refusal", async () => {
    const { client } = setup({ permissionMode: "deny" });

    await expect(client.connect()).rejects.toBeInstanceOf(FluidError);
    expect(client.state.authorization).toBe("denied");
  });

  it("reclaims finished inferences so a long chat does not grow forever", async () => {
    // Each entry keeps the whole accumulated text, and the map is copied on
    // every delta. Keeping them all made cost climb with the number of turns.
    const { client } = setup({ reply: "ok" });
    await client.connect();
    const session = await client.createSession();

    for (let turn = 0; turn < 4; turn += 1) {
      const handle = client.createInference({
        sessionId: session.id,
        messages: [{ role: "user", content: `turn ${turn}` }],
        stream: true,
      });
      // Drain, or the completed promise rejects with nobody listening.
      for await (const _event of handle.events) void _event;
      await handle.completed;
    }

    expect(Object.keys(client.state.inference)).toHaveLength(1);
  });

  it("cancels the generation when the consumer stops reading", async () => {
    // `break` out of `for await` used to leave the wallet generating into a
    // queue nobody would read: paid for, delivered nowhere.
    const { client, wallet } = setup({ reply: "a b c d e f", chunkDelayMs: 1 });
    await client.connect();
    const session = await client.createSession();

    const handle = client.createInference({
      sessionId: session.id,
      messages: [{ role: "user", content: "hi" }],
      stream: true,
    });
    handle.completed.catch(() => undefined);

    for await (const event of handle.events) {
      void event;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(wallet.calls.some((call) => call.method === "inference.cancel")).toBe(true);
  });

  it("reports a locked wallet as available-but-locked, not as missing", async () => {
    // "No wallet" and "a wallet behind a password" used to arrive as the same
    // thing, so a page offered to install an extension that was already there.
    const { client } = setup({ locked: true });
    const info = await client.detect();

    expect(info?.status).toBe("locked");
    expect(client.locked).toBe(true);
    expect(client.state.availability).toBe("available");
  });

  it("raises the wallet window, and stays usable on a wallet that cannot", async () => {
    const { client, wallet } = setup();

    expect(await client.openWallet()).toBe(true);
    expect(wallet.opens).toBe(1);
    expect(wallet.calls.at(-1)?.method).toBe("wallet.open");

    // A wallet older than `wallet.open` must make the button look unsupported,
    // not broken: this is the difference between "upgrade the extension" and
    // "something is wrong".
    wallet.request = async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: FluidErrorCode.MethodNotFound, message: "Unknown method." },
    });
    expect(await client.openWallet()).toBe(false);
  });

  it("learns the wallet locked itself from the refusal alone", async () => {
    // Auto-lock happens between two calls: the page never asked for a fresh
    // `getInfo`, so the 4101 is the only evidence a badge has to work with.
    const { client, wallet } = setup();
    await client.detect();
    expect(client.locked).toBe(false);

    wallet.request = async (request) => ({
      jsonrpc: "2.0",
      id: request.id,
      error: {
        code: FluidErrorCode.Locked,
        message: "Fluid Wallet is locked.",
        data: { reason: "locked" },
      },
    });

    await expect(client.usage()).rejects.toMatchObject({ code: FluidErrorCode.Locked });
    expect(client.locked).toBe(true);
    expect(client.state.wallet?.status).toBe("locked");
  });
});
