import { FluidError, FluidErrorCode } from "./errors";
import { FLUID_CAPABILITIES } from "./types";
import type {
  FluidCapability,
  FluidEvent,
  FluidInferenceParams,
  FluidMessage,
  FluidRequest,
  FluidResponse,
} from "./types";

/**
 * Hard limits applied to everything a page can send.
 *
 * They are deliberately part of the protocol so every wallet enforces the same
 * envelope, and so an app can fail fast before a request is rejected.
 */
export const FLUID_LIMITS = {
  maxRequestBytes: 1_000_000,
  maxMessages: 256,
  maxMessageChars: 100_000,
  maxTools: 64,
  maxToolNameChars: 64,
  /** A single request may not hang forever, even if the model is slow. */
  requestTimeoutMs: 60_000,
  /** Streaming aborts when no event arrives within this window. */
  streamIdleTimeoutMs: 30_000,
} as const;

export type FluidValidation<T> =
  | { ok: true; value: T }
  | { ok: false; error: FluidError };

function invalid(message: string, data?: unknown): { ok: false; error: FluidError } {
  return { ok: false, error: new FluidError(FluidErrorCode.InvalidParams, message, data) };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isCapability(value: unknown): value is FluidCapability {
  return (FLUID_CAPABILITIES as readonly unknown[]).includes(value);
}

/** Validates the request envelope. Method-specific params are validated by the wallet. */
export function parseRequest(input: unknown): FluidValidation<FluidRequest> {
  if (!isRecord(input)) return invalid("Request must be an object.");
  if (input.jsonrpc !== "2.0") return invalid('Request must declare jsonrpc: "2.0".');
  if (typeof input.id !== "string" || input.id.length === 0) {
    return invalid("Request id must be a non-empty string.");
  }
  if (typeof input.method !== "string" || input.method.length === 0) {
    return invalid("Request method must be a non-empty string.");
  }
  if (input.params !== undefined && !isRecord(input.params)) {
    return invalid("Request params must be an object when present.");
  }
  return { ok: true, value: input as unknown as FluidRequest };
}

export function parseResponse(input: unknown): FluidValidation<FluidResponse> {
  if (!isRecord(input)) return invalid("Response must be an object.");
  if (input.jsonrpc !== "2.0") return invalid('Response must declare jsonrpc: "2.0".');
  if (typeof input.id !== "string") return invalid("Response id must be a string.");

  const hasResult = input.result !== undefined;
  const hasError = isRecord(input.error);
  if (hasResult === hasError) {
    return invalid("Response must contain exactly one of result or error.");
  }
  return { ok: true, value: input as unknown as FluidResponse };
}

export function parseEvent(input: unknown): FluidValidation<FluidEvent> {
  if (!isRecord(input)) return invalid("Event must be an object.");
  if (typeof input.type !== "string" || input.type.length === 0) {
    return invalid("Event type must be a non-empty string.");
  }
  if (input.payload === undefined) return invalid("Event payload is required.");
  return { ok: true, value: input as unknown as FluidEvent };
}

function parseMessage(input: unknown, index: number): FluidValidation<FluidMessage> {
  if (!isRecord(input)) return invalid(`messages[${index}] must be an object.`);
  const role = input.role;
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") {
    return invalid(`messages[${index}].role is not a valid role.`);
  }

  const content = input.content;
  if (typeof content === "string") {
    if (content.length > FLUID_LIMITS.maxMessageChars) {
      return invalid(`messages[${index}].content exceeds the size limit.`);
    }
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!isRecord(part) || (part.type !== "text" && part.type !== "image")) {
        return invalid(`messages[${index}].content contains an unsupported part.`);
      }
    }
  } else {
    return invalid(`messages[${index}].content must be a string or an array of parts.`);
  }

  return { ok: true, value: input as unknown as FluidMessage };
}

/**
 * Validates an inference request.
 *
 * This is the most expensive call a page can make, so the checks run before the
 * wallet touches a provider: roles, message count, tool count and tool names.
 */
export function parseInferenceParams(input: unknown): FluidValidation<FluidInferenceParams> {
  if (!isRecord(input)) return invalid("Inference params must be an object.");
  if (typeof input.sessionId !== "string" || input.sessionId.length === 0) {
    return invalid("sessionId is required.");
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    return invalid("messages must be a non-empty array.");
  }
  if (input.messages.length > FLUID_LIMITS.maxMessages) {
    return invalid(`messages exceeds the limit of ${FLUID_LIMITS.maxMessages}.`);
  }

  for (const [index, message] of input.messages.entries()) {
    const parsed = parseMessage(message, index);
    if (!parsed.ok) return parsed;
  }

  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools)) return invalid("tools must be an array.");
    if (input.tools.length > FLUID_LIMITS.maxTools) {
      return invalid(`tools exceeds the limit of ${FLUID_LIMITS.maxTools}.`);
    }
    for (const tool of input.tools) {
      if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.length === 0) {
        return invalid("Every tool needs a name.");
      }
      if (tool.name.length > FLUID_LIMITS.maxToolNameChars) {
        return invalid(`Tool name "${tool.name}" is too long.`);
      }
      if (!isRecord(tool.parameters)) {
        return invalid(`Tool "${tool.name}" must declare a JSON Schema parameters object.`);
      }
    }
  }

  return { ok: true, value: input as unknown as FluidInferenceParams };
}

export function assertInferenceParams(input: unknown): FluidInferenceParams {
  const parsed = parseInferenceParams(input);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
}

/** Normalises anything thrown into a `FluidError` without leaking internals. */
export function toFluidError(error: unknown): FluidError {
  if (error instanceof FluidError) return error;
  return new FluidError(
    FluidErrorCode.InternalError,
    error instanceof Error ? error.message : "Unexpected wallet error.",
  );
}
