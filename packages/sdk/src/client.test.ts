import { FLUID_EVENTS, FluidError, FluidErrorCode } from "@fluid-wallet/protocol";
import { createMockWallet } from "@fluid-wallet/test-kit";
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
});
