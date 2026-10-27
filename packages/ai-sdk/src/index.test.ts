import { BridgeTransport, FluidClient } from "@fluid-wallet/sdk";
import { createMockWallet } from "@fluid-wallet/test-kit";
import type { UIMessage, UIMessageChunk } from "ai";
import { describe, expect, it } from "vitest";

import { FluidChatTransport, toFluidMessages } from "./index";

const userMessage: UIMessage = {
  id: "m1",
  role: "user",
  parts: [{ type: "text", text: "hello wallet" }],
};

async function readAll(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = [];
  const reader = stream.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return chunks;
}

describe("toFluidMessages", () => {
  it("keeps only text parts", () => {
    expect(toFluidMessages([userMessage])).toEqual([
      { role: "user", content: "hello wallet" },
    ]);
  });
});

describe("FluidChatTransport", () => {
  it("streams wallet deltas as UI message chunks", async () => {
    const wallet = createMockWallet({ reply: "hi there" });
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });
    await client.connect();

    const transport = new FluidChatTransport({ client, model: "deepseek-chat" });
    const stream = await transport.sendMessages({
      trigger: "submit-message",
      chatId: "chat-1",
      messageId: undefined,
      messages: [userMessage],
      abortSignal: undefined,
    });

    const chunks = await readAll(stream);
    const text = chunks
      .filter((chunk): chunk is Extract<UIMessageChunk, { type: "text-delta" }> => chunk.type === "text-delta")
      .map((chunk) => chunk.delta)
      .join("");

    expect(text).toBe("hi there");
    expect(chunks[0]).toMatchObject({ type: "start" });
    expect(chunks.at(-1)).toMatchObject({ type: "finish", finishReason: "stop" });
  });

  it("reuses one session across sends", async () => {
    const wallet = createMockWallet();
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });
    await client.connect();

    const transport = new FluidChatTransport({ client });
    const send = () =>
      transport.sendMessages({
        trigger: "submit-message",
        chatId: "chat-1",
        messageId: undefined,
        messages: [userMessage],
        abortSignal: undefined,
      });

    await readAll(await send());
    const first = transport.sessionId;
    await readAll(await send());

    expect(transport.sessionId).toBe(first);
    expect(wallet.calls.filter((call) => call.method === "session.create")).toHaveLength(1);
  });

  it("cannot resume a stream yet", async () => {
    const wallet = createMockWallet();
    const client = new FluidClient({ transport: new BridgeTransport(wallet) });
    const transport = new FluidChatTransport({ client });

    expect(await transport.reconnectToStream({ chatId: "chat-1" })).toBeNull();
  });
});
