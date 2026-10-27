import {
  FLUID_EVENTS,
  FluidError,
  FluidErrorCode,
  hasCapability,
  type FluidFinishReason,
  type FluidInferenceParams,
  type FluidInferenceResult,
  type FluidMessage,
  type FluidPermission,
  type FluidSession,
  type FluidToolCall,
  type FluidUsage,
} from "@fluid-wallet/protocol";

import { db } from "./db";
import { emit } from "./events";
import { resolveRoute } from "./providers";

/** Streams are batched before hitting the message channel: one post per token is wasteful. */
const DELTA_FLUSH_MS = 40;

interface ActiveInference {
  controller: AbortController;
  sessionId: string;
  providerId: string;
  model: string;
}

const active = new Map<string, ActiveInference>();

export interface RunInferenceInput {
  requestId: string;
  origin: string;
  permission: FluidPermission;
  session: FluidSession;
  params: FluidInferenceParams;
}

export function cancelInference(inferenceId: string): boolean {
  const entry = active.get(inferenceId);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

export function isRunning(inferenceId: string): boolean {
  return active.has(inferenceId);
}

/**
 * Runs one generation end to end.
 *
 * The JSON-RPC request stays open until the last token arrives: the app gets a
 * result object, while every intermediate step is also pushed as an event so a
 * UI can render progressively. Cancellation resolves the request with
 * `finishReason: "cancelled"` rather than rejecting — a cancelled generation is
 * an expected outcome, not a failure.
 */
export async function runInference(input: RunInferenceInput): Promise<FluidInferenceResult> {
  const { requestId, origin, permission, session, params } = input;

  const route = await resolveRoute(params.model ?? session.model, permission.providers);
  const inferenceId = requestId;
  const controller = new AbortController();

  active.set(inferenceId, {
    controller,
    sessionId: session.id,
    providerId: route.providerId,
    model: route.model,
  });

  await emit(requestId, {
    type: FLUID_EVENTS.InferenceStart,
    requestId,
    payload: { inferenceId, sessionId: session.id, model: route.model },
  });

  const startedAt = Date.now();
  let text = "";
  let finishReason: FluidFinishReason = "stop";
  let usage: FluidUsage | undefined;
  const toolCalls: FluidToolCall[] = [];

  let pending = "";
  let flushTimer: ReturnType<typeof setTimeout> | undefined;

  const flush = async (): Promise<void> => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    if (!pending) return;
    const chunk = pending;
    pending = "";
    await emit(requestId, {
      type: FLUID_EVENTS.InferenceDelta,
      requestId,
      payload: { inferenceId, text: chunk },
    });
  };

  const schedule = (): void => {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      void flush();
    }, DELTA_FLUSH_MS);
  };

  try {
    const stream = route.adapter.streamChat({
      model: route.model,
      messages: params.messages.map(toProviderMessage),
      temperature: params.temperature,
      topP: params.topP,
      maxTokens: params.maxTokens,
      stopSequences: params.stopSequences,
      tools: hasCapability(permission, "inference:tools") ? params.tools : undefined,
      toolChoice: params.toolChoice,
      signal: controller.signal,
    });

    for await (const chunk of stream) {
      if (chunk.type === "text-delta") {
        text += chunk.text;
        pending += chunk.text;
        schedule();
        continue;
      }
      if (chunk.type === "tool-call") {
        toolCalls.push(chunk.toolCall);
        await flush();
        await emit(requestId, {
          type: FLUID_EVENTS.InferenceToolCall,
          requestId,
          payload: { inferenceId, toolCall: chunk.toolCall },
        });
        continue;
      }
      finishReason = chunk.reason;
      usage = chunk.usage ?? usage;
    }

    await flush();

    const result: FluidInferenceResult = {
      id: inferenceId,
      sessionId: session.id,
      model: route.model,
      message: {
        role: "assistant",
        content: text,
        ...(toolCalls.length ? { toolCalls } : {}),
        createdAt: Date.now(),
      },
      finishReason,
      ...(usage ? { usage } : {}),
      ...(toolCalls.length ? { toolCalls } : {}),
      createdAt: Date.now(),
    };

    await emit(requestId, { type: FLUID_EVENTS.InferenceDone, requestId, payload: result });
    await writeLog({
      id: inferenceId,
      origin,
      appId: session.appId,
      providerId: route.providerId,
      model: route.model,
      status: "success",
      startedAt,
      usage,
    });
    await persistTurn({ session, params, result, permission });

    return result;
  } catch (error) {
    await flush();

    const cancelled =
      controller.signal.aborted ||
      (error instanceof FluidError && error.code === FluidErrorCode.InferenceCancelled);

    if (cancelled) {
      await emit(requestId, {
        type: FLUID_EVENTS.InferenceCancelled,
        requestId,
        payload: { inferenceId, sessionId: session.id },
      });
      await writeLog({
        id: inferenceId,
        origin,
        appId: session.appId,
        providerId: route.providerId,
        model: route.model,
        status: "cancelled",
        startedAt,
        usage,
      });

      return {
        id: inferenceId,
        sessionId: session.id,
        model: route.model,
        message: { role: "assistant", content: text, createdAt: Date.now() },
        finishReason: "cancelled",
        createdAt: Date.now(),
      };
    }

    const fluidError =
      error instanceof FluidError
        ? error
        : new FluidError(
            FluidErrorCode.InferenceFailed,
            error instanceof Error ? error.message : "The provider call failed.",
          );

    await emit(requestId, {
      type: FLUID_EVENTS.InferenceError,
      requestId,
      payload: { inferenceId, error: fluidError.toJSON() },
    });
    await writeLog({
      id: inferenceId,
      origin,
      appId: session.appId,
      providerId: route.providerId,
      model: route.model,
      status: "error",
      startedAt,
      usage,
      errorCode: fluidError.code,
    });

    throw fluidError;
  } finally {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    active.delete(inferenceId);
  }
}

/**
 * Image parts are dropped rather than downgraded: silently sending a URL-less
 * placeholder would produce answers about content the model never saw.
 */
function toProviderMessage(message: FluidMessage): FluidMessage {
  if (typeof message.content === "string") return message;
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  return { ...message, content: text };
}

interface LogInput {
  id: string;
  origin: string;
  appId?: string;
  providerId: string;
  model: string;
  status: "success" | "error" | "cancelled" | "timeout";
  startedAt: number;
  usage?: FluidUsage;
  errorCode?: number;
}

async function writeLog(input: LogInput): Promise<void> {
  const finishedAt = Date.now();
  await db().inferenceLogs.put({
    id: input.id,
    origin: input.origin,
    appId: input.appId,
    providerId: input.providerId,
    model: input.model,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt,
    durationMs: finishedAt - input.startedAt,
    inputTokens: input.usage?.inputTokens,
    outputTokens: input.usage?.outputTokens,
    errorCode: input.errorCode,
  });
}

/**
 * Persists the turn only when the app asked for history *and* holds the write
 * capability. The default is not to store conversation content at all.
 */
async function persistTurn(input: {
  session: FluidSession;
  params: FluidInferenceParams;
  result: FluidInferenceResult;
  permission: FluidPermission;
}): Promise<void> {
  const { session, params, result, permission } = input;
  if (!hasCapability(permission, "conversation:write")) return;

  const record = await db().sessions.get(session.id);
  if (!record) return;

  let conversationId = record.conversationId;
  const now = Date.now();

  if (!conversationId) {
    conversationId = crypto.randomUUID();
    await db().conversations.put({
      id: conversationId,
      origin: session.origin,
      appId: session.appId,
      title: firstUserText(params.messages)?.slice(0, 80),
      model: result.model,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await db().sessions.update(session.id, { conversationId });
  }

  const incoming = params.messages.filter((message) => message.role === "user").slice(-1);
  const rows = [...incoming, result.message].map((message) => ({
    id: crypto.randomUUID(),
    conversationId: conversationId as string,
    role: message.role,
    content: typeof message.content === "string" ? message.content : JSON.stringify(message.content),
    toolCalls: message.toolCalls,
    createdAt: message.createdAt ?? now,
  }));

  await db().messages.bulkPut(rows);
  const conversation = await db().conversations.get(conversationId);
  if (conversation) {
    await db().conversations.update(conversationId, {
      messageCount: conversation.messageCount + rows.length,
      updatedAt: now,
      model: result.model,
    });
  }
}

function firstUserText(messages: FluidMessage[]): string | undefined {
  const user = messages.find((message) => message.role === "user");
  if (!user) return undefined;
  if (typeof user.content === "string") return user.content;
  return user.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}
