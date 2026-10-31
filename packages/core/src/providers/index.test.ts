import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";
import { describe, expect, it } from "vitest";

import { createOpenAICompatibleProvider, iterateSse } from "./index";

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
}

function jsonResponse(frames: string[]): Response {
  return new Response(sseStream(frames), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

describe("iterateSse", () => {
  it("splits frames on CRLF and yields the trailing frame", async () => {
    const body = sseStream(["data: one\r\n\r\ndata: two\r\n\r\ndata: three"]);
    const payloads: string[] = [];

    for await (const payload of iterateSse(body)) payloads.push(payload);

    expect(payloads).toEqual(["one", "two", "three"]);
  });
});

describe("createOpenAICompatibleProvider", () => {
  it("streams text deltas and a finish event with usage", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "test",
      name: "Test provider",
      baseUrl: "https://example.test/v1",
      apiKey: "sk-secret",
      fetchImpl: async () =>
        jsonResponse([
          'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
          "data: [DONE]\n\n",
        ]),
    });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks[0]).toEqual({ type: "text-delta", text: "Hello" });
    expect(chunks.at(-1)).toEqual({
      type: "finish",
      reason: "stop",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
  });

  it("reads usage from the trailing frame real servers send", async () => {
    // What OpenAI and DeepSeek actually emit once `include_usage` is set: the
    // finish frame has no usage, and a final frame with an empty `choices`
    // array carries it. Reading usage only at `finish_reason` loses it here.
    let body: Record<string, unknown> = {};
    const provider = createOpenAICompatibleProvider({
      id: "test",
      name: "Test provider",
      baseUrl: "https://example.test/v1",
      apiKey: "sk-secret",
      fetchImpl: async (_input, init) => {
        body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse([
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}\n\n',
          "data: [DONE]\n\n",
        ]);
      },
    });

    const chunks = [];
    for await (const chunk of provider.streamChat({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
    })) {
      chunks.push(chunk);
    }

    expect(body.stream_options).toEqual({ include_usage: true });
    expect(chunks.at(-1)).toEqual({
      type: "finish",
      reason: "stop",
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    });
  });

  it("accumulates a full reply through chat()", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "test",
      name: "Test provider",
      baseUrl: "https://example.test/v1",
      apiKey: "sk-secret",
      fetchImpl: async () =>
        jsonResponse([
          'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
          'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
          'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        ]),
    });

    const result = await provider.chat({
      model: "deepseek-chat",
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result).toMatchObject({ text: "ab", finishReason: "stop" });
  });

  it("maps an auth failure to Unauthorized and never leaks the key", async () => {
    const provider = createOpenAICompatibleProvider({
      id: "test",
      name: "Test provider",
      baseUrl: "https://example.test/v1",
      apiKey: "sk-super-secret",
      fetchImpl: async () => new Response("invalid api key", { status: 401 }),
    });

    const error = await provider
      .chat({ model: "deepseek-chat", messages: [{ role: "user", content: "hi" }] })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FluidError);
    expect((error as FluidError).code).toBe(FluidErrorCode.Unauthorized);
    expect(JSON.stringify(error)).not.toContain("sk-super-secret");
  });
});
