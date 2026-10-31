import {
  FLUID_EVENTS,
  messageToText,
  type FluidFinishReason,
  type FluidInferenceResult,
  type FluidMessage,
} from "@fluid-wallet/protocol";
import type { FluidClient } from "../client";
import type { ChatTransport, FinishReason, UIMessage, UIMessageChunk } from "ai";

export interface FluidChatTransportOptions {
  client: FluidClient;
  /** Model id sent to the wallet; the wallet clamps it to the granted scope. */
  model?: string;
  /** Reuse an existing session instead of creating one on first send. */
  sessionId?: string;
  /** Prepended to every request as a `system` message. */
  system?: string;
}

const FINISH_REASONS = {
  stop: "stop",
  length: "length",
  "tool-calls": "tool-calls",
  "content-filter": "content-filter",
  cancelled: "interrupted",
  error: "error",
} as const satisfies Record<FluidFinishReason, FinishReason>;

/** Converts UI messages into protocol messages. Only text parts cross the boundary today. */
export function toFluidMessages(messages: UIMessage[]): FluidMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(""),
  }));
}

/**
 * Vercel AI SDK transport backed by a Fluid Wallet client.
 *
 * `useChat({ transport })` works unchanged: the wallet becomes the model
 * provider, and no key or base URL reaches the app.
 *
 * Scope for 0.1.0: text streaming and tool calls. Images, structured output and
 * resume are not promised yet — see `specs/streaming.md`.
 */
export class FluidChatTransport implements ChatTransport<UIMessage> {
  readonly #client: FluidClient;
  readonly #model?: string;
  readonly #system?: string;
  #sessionId?: string;

  constructor(options: FluidChatTransportOptions) {
    this.#client = options.client;
    this.#model = options.model;
    this.#system = options.system;
    this.#sessionId = options.sessionId;
  }

  get sessionId(): string | undefined {
    return this.#sessionId;
  }

  async #ensureSession(): Promise<string> {
    if (this.#sessionId) return this.#sessionId;

    const session = await this.#client.createSession(this.#model ? { model: this.#model } : {});
    this.#sessionId = session.id;
    return session.id;
  }

  async sendMessages(options: {
    trigger: "submit-message" | "regenerate-message";
    chatId: string;
    messageId: string | undefined;
    messages: UIMessage[];
    abortSignal: AbortSignal | undefined;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk>> {
    const sessionId = await this.#ensureSession();

    const history: FluidMessage[] = [
      ...(this.#system ? [{ role: "system" as const, content: this.#system }] : []),
      ...toFluidMessages(options.messages),
    ];

    const inference = this.#client.createInference({
      sessionId,
      ...(this.#model ? { model: this.#model } : {}),
      messages: history,
      stream: true,
    });

    const textId = `text-${inference.requestId}`;
    const abort = (): void => {
      void inference.cancel();
    };
    options.abortSignal?.addEventListener("abort", abort, { once: true });

    return new ReadableStream<UIMessageChunk>({
      start: async (controller) => {
        let finished = false;
        const emit = (chunk: UIMessageChunk): void => {
          if (finished) return;
          try {
            controller.enqueue(chunk);
          } catch {
            finished = true;
          }
        };

        const close = (): void => {
          finished = true;
          options.abortSignal?.removeEventListener("abort", abort);
          try {
            controller.close();
          } catch {
            // Already closed by a cancel; nothing to do.
          }
        };

        emit({ type: "start", messageId: inference.requestId });
        emit({ type: "start-step" });
        emit({ type: "text-start", id: textId });

        try {
          for await (const event of inference.events) {
            if (event.type === FLUID_EVENTS.InferenceDelta) {
              emit({
                type: "text-delta",
                id: textId,
                delta: (event.payload as { text: string }).text,
              });
            } else if (event.type === FLUID_EVENTS.InferenceToolCall) {
              const { toolCall } = event.payload as {
                toolCall: { id: string; name: string; arguments: unknown };
              };
              emit({
                type: "tool-input-available",
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                input: toolCall.arguments,
              });
            } else if (event.type === FLUID_EVENTS.InferenceError) {
              const { error } = event.payload as { error: { message: string } };
              emit({ type: "error", errorText: error.message });
            }
          }

          const result: FluidInferenceResult = await inference.completed;
          emit({ type: "text-end", id: textId });
          emit({ type: "finish-step" });
          emit({
            type: "finish",
            finishReason: FINISH_REASONS[result.finishReason] ?? "other",
            messageMetadata: { model: result.model, usage: result.usage },
          });
        } catch (error) {
          emit({
            type: "error",
            errorText: error instanceof Error ? error.message : "Fluid Wallet inference failed.",
          });
        } finally {
          close();
        }
      },

      cancel: () => {
        abort();
      },
    });
  }

  async reconnectToStream(_options: {
    chatId: string;
    abortSignal?: AbortSignal;
    headers?: Record<string, string> | Headers;
    body?: object;
    metadata?: unknown;
  }): Promise<ReadableStream<UIMessageChunk> | null> {
    // Resume is not part of 0.1.0: the wallet cannot replay a lost stream yet.
    return null;
  }
}

export function createFluidChatTransport(options: FluidChatTransportOptions): FluidChatTransport {
  return new FluidChatTransport(options);
}

/** Helper for apps that need the raw text of a completed inference. */
export function resultToText(result: FluidInferenceResult): string {
  return messageToText(result.message);
}
