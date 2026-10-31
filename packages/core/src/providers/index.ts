import {
  FluidError,
  FluidErrorCode,
  type FluidFinishReason,
  type FluidMessage,
  type FluidToolCall,
  type FluidToolChoice,
  type FluidToolDefinition,
  type FluidUsage,
} from "@fluid-wallet/protocol";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderConfig {
  id: string;
  name: string;
  /** Base URL without the trailing `/chat/completions`. */
  baseUrl: string;
  apiKey: string;
  defaultModel?: string;
  models?: string[];
  headers?: Record<string, string>;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

export interface ChatRequest {
  model: string;
  messages: FluidMessage[];
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tools?: FluidToolDefinition[];
  toolChoice?: FluidToolChoice;
  signal?: AbortSignal;
}

export type ProviderChunk =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: FluidToolCall }
  | { type: "finish"; reason: FluidFinishReason; usage?: FluidUsage };

export interface ChatResult {
  text: string;
  finishReason: FluidFinishReason;
  usage?: FluidUsage;
  toolCalls: FluidToolCall[];
}

/** Everything the trusted runtime needs from a model provider. */
export interface ProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly models: string[];
  readonly defaultModel?: string;
  listModels(): Promise<string[]>;
  streamChat(request: ChatRequest): AsyncIterable<ProviderChunk>;
  chat(request: ChatRequest): Promise<ChatResult>;
}

interface OpenAIChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: Array<Record<string, unknown>> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

const REASON_MAP: Record<string, FluidFinishReason> = {
  stop: "stop",
  length: "length",
  tool_calls: "tool-calls",
  content_filter: "content-filter",
};

function mapUsage(usage: OpenAIChunk["usage"]): FluidUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: usage.total_tokens ?? inputTokens + outputTokens,
  };
}

function mapStatus(status: number): number {
  switch (status) {
    case 401:
      return FluidErrorCode.Unauthorized;
    case 403:
      return FluidErrorCode.PermissionDenied;
    case 429:
      return FluidErrorCode.RateLimited;
    default:
      return status >= 500 ? FluidErrorCode.ProviderUnavailable : FluidErrorCode.InferenceFailed;
  }
}

function toOpenAIMessages(messages: FluidMessage[]): unknown[] {
  return messages.map((message) => {
    const content =
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => (part.type === "text" ? part.text : "")).join("");

    return {
      role: message.role,
      content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
            })),
          }
        : {}),
    };
  });
}

/**
 * Parses a `text/event-stream` body into `data:` payloads.
 *
 * Handles CRLF, multi-line data fields and a final frame without a trailing
 * blank line, which real providers all emit at some point.
 */
export async function* iterateSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const extract = (block: string): string | null => {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    return data.length > 0 ? data : null;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + (buffer[boundary] === "\r" ? 4 : 2));
        const payload = extract(block);
        if (payload) yield payload;
        boundary = buffer.search(/\r?\n\r?\n/);
      }
    }

    const tail = extract(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Adapter for any OpenAI-compatible `/chat/completions` endpoint.
 *
 * Streaming is the primary path; `chat()` drains the same generator so both
 * calls share one code path and one error mapping.
 */
export function createOpenAICompatibleProvider(config: ProviderConfig): ProviderAdapter {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = config.fetchImpl ?? ((input, init) => fetch(input, init));

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${config.apiKey}`,
    ...config.headers,
  };

  const buildBody = (request: ChatRequest): Record<string, unknown> => ({
    model: request.model,
    messages: toOpenAIMessages(request.messages),
    stream: true,
    // OpenAI-compatible servers omit token counts from a stream by default;
    // this is the only switch that makes them send a final `usage` frame. It is
    // part of the streaming spec and DeepSeek honours it, so a wallet that
    // wants an activity log with real numbers has to ask for it explicitly.
    stream_options: { include_usage: true },
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    ...(request.stopSequences ? { stop: request.stopSequences } : {}),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.parameters,
            },
          })),
        }
      : {}),
    ...(request.toolChoice
      ? {
          tool_choice:
            typeof request.toolChoice === "string"
              ? request.toolChoice
              : { type: "function", function: { name: request.toolChoice.name } },
        }
      : {}),
  });

  async function* streamChat(request: ChatRequest): AsyncGenerator<ProviderChunk> {
    const response = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildBody(request)),
      signal: request.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new FluidError(
        mapStatus(response.status),
        `Provider "${config.id}" responded with ${response.status}.`,
        detail.slice(0, 500),
      );
    }
    if (!response.body) {
      throw new FluidError(
        FluidErrorCode.ProviderUnavailable,
        `Provider "${config.id}" returned an empty body.`,
      );
    }

    let finished = false;
    // Usage arrives on the frame carrying `finish_reason` on some servers, and
    // on a separate trailing frame with an empty `choices` array on others —
    // every OpenAI-compatible server that honours `include_usage` does the
    // latter. Reading it only at `finish_reason` therefore loses it on the
    // servers people actually use, so both shapes are collected here and the
    // finish event is held back until the stream is done.
    let usage: FluidUsage | undefined;
    let finishReason: FluidFinishReason | undefined;
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const payload of iterateSse(response.body)) {
      if (payload === "[DONE]") break;

      let chunk: OpenAIChunk;
      try {
        chunk = JSON.parse(payload) as OpenAIChunk;
      } catch {
        throw new FluidError(
          FluidErrorCode.InferenceFailed,
          "Provider sent a malformed stream chunk.",
        );
      }

      usage = mapUsage(chunk.usage) ?? usage;

      const choice = chunk.choices?.[0];
      const text = choice?.delta?.content;
      if (typeof text === "string" && text.length > 0) {
        yield { type: "text-delta", text };
      }

      for (const [index, raw] of (choice?.delta?.tool_calls ?? []).entries()) {
        const fn = raw.function as { name?: string; arguments?: string } | undefined;
        const existing = toolCalls.get(index) ?? { id: String(raw.id ?? index), name: "", arguments: "" };
        existing.name = fn?.name ?? existing.name;
        existing.arguments += fn?.arguments ?? "";
        toolCalls.set(index, existing);
      }

      if (choice?.finish_reason && !finished) {
        finished = true;
        finishReason = REASON_MAP[choice.finish_reason] ?? "stop";
        for (const call of toolCalls.values()) {
          let args: unknown = {};
          try {
            args = call.arguments ? JSON.parse(call.arguments) : {};
          } catch {
            args = { raw: call.arguments };
          }
          yield { type: "tool-call", toolCall: { id: call.id, name: call.name, arguments: args } };
        }
      }
    }

    yield {
      type: "finish",
      reason: finishReason ?? "stop",
      ...(usage ? { usage } : {}),
    };
  }

  return {
    id: config.id,
    name: config.name,
    models: config.models ?? [],
    defaultModel: config.defaultModel,

    async listModels(): Promise<string[]> {
      return config.models ?? [];
    },

    streamChat,

    async chat(request: ChatRequest): Promise<ChatResult> {
      let text = "";
      let finishReason: FluidFinishReason = "stop";
      let usage: FluidUsage | undefined;
      const toolCalls: FluidToolCall[] = [];

      for await (const chunk of streamChat(request)) {
        if (chunk.type === "text-delta") {
          text += chunk.text;
        } else if (chunk.type === "tool-call") {
          toolCalls.push(chunk.toolCall);
        } else {
          finishReason = chunk.reason;
          usage = chunk.usage ?? usage;
        }
      }

      return { text, finishReason, usage, toolCalls };
    },
  };
}

/**
 * No `createDeepSeekProvider` here on purpose.
 *
 * It used to pin `deepseek-chat` as a default and ship a two-model catalogue,
 * which made the wallet answer "model not configured" against a provider that
 * had moved on. The base URL is a preset in the UI; the catalogue comes from
 * `GET /models`.
 */
