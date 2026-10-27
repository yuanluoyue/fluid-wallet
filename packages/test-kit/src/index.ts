import {
  FLUID_EVENTS,
  FluidError,
  FluidErrorCode,
  FluidMethod,
  PROTOCOL_VERSION,
  isFluidMethodName,
  messageToText,
  parseInferenceParams,
  parseProxyParams,
  parseRequest,
  toFluidError,
  type FluidBridge,
  type FluidEvent,
  type FluidInferenceParams,
  type FluidInferenceResult,
  type FluidMessage,
  type FluidModel,
  type FluidPermission,
  type FluidPermissionRequest,
  type FluidProvider,
  type FluidProxyParams,
  type FluidProxyResponse,
  type FluidRequest,
  type FluidResponse,
  type FluidSession,
  type FluidWalletInfo,
} from "@fluid-wallet/protocol";

/** How the mock wallet reacts to `wallet.connect`. */
export type MockPermissionMode = "auto" | "deny" | "expired";

/** Canned answer for a proxied provider request. */
export interface MockProxyResult {
  status: number;
  contentType: string;
  body: string;
}

export interface MockWalletOptions {
  origin?: string;
  locked?: boolean;
  permissionMode?: MockPermissionMode;
  /** Capabilities the mock reports as available. */
  walletVersion?: string;
  providers?: FluidProvider[];
  models?: FluidModel[];
  /** Reply text, an explicit list of chunks, or a function that picks one per request. */
  reply?: MockReply;
  /** Answer for `inference.proxy`; defaults to echoing the request back as JSON. */
  proxy?: (params: FluidProxyParams) => MockProxyResult | Promise<MockProxyResult>;
  /** Delay between stream chunks, in milliseconds. */
  chunkDelayMs?: number;
  now?: () => number;
}

export type MockReply =
  | string
  | string[]
  | ((params: FluidInferenceParams) => string | string[]);

export interface MockWalletState {
  permissions: Map<string, FluidPermission>;
  sessions: Map<string, FluidSession>;
  conversations: Map<string, FluidMessage[]>;
}

export interface MockWallet extends FluidBridge {
  readonly state: MockWalletState;
  /** Every request the wallet received, in order — useful for assertions. */
  readonly calls: FluidRequest[];
  emit(event: FluidEvent): void;
  grant(permission: FluidPermission): void;
  dispose(): void;
}

const DEFAULT_PROVIDER: FluidProvider = {
  id: "deepseek",
  name: "DeepSeek",
  kind: "openai-compatible",
  defaultModel: "deepseek-chat",
  models: ["deepseek-chat", "deepseek-reasoner"],
};

const DEFAULT_MODELS: FluidModel[] = [
  {
    id: "deepseek-chat",
    providerId: "deepseek",
    displayName: "DeepSeek Chat",
    capabilities: ["text", "streaming", "tools", "json"],
    contextWindow: 64_000,
  },
  {
    id: "deepseek-reasoner",
    providerId: "deepseek",
    displayName: "DeepSeek Reasoner",
    capabilities: ["text", "streaming", "reasoning"],
    contextWindow: 64_000,
  },
];

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function splitReply(reply: string | string[]): string[] {
  if (Array.isArray(reply)) return reply;
  return reply.match(/\S+\s*/g) ?? [reply];
}

/** Echoes the request line, which is enough to verify routing and reassembly. */
function defaultProxy(params: FluidProxyParams): MockProxyResult {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      path: params.path,
      method: params.method ?? (params.body === undefined ? "GET" : "POST"),
      body: params.body ?? null,
    }),
  };
}

/**
 * In-memory wallet that speaks the protocol.
 *
 * It exists so the SDK and any third-party implementation can be tested against
 * the same contract without a browser, an extension or an API key.
 */
export function createMockWallet(options: MockWalletOptions = {}): MockWallet {
  const origin = options.origin ?? "https://mock.app";
  const now = options.now ?? (() => Date.now());
  const chunkDelayMs = options.chunkDelayMs ?? 0;
  const permissionMode = options.permissionMode ?? "auto";
  const replyOption: MockReply = options.reply ?? ((params: FluidInferenceParams) => {
    const last = params.messages.at(-1);
    return `mock reply to: ${last ? messageToText(last) : ""}`;
  });
  const reply = (params: FluidInferenceParams): string | string[] =>
    typeof replyOption === "function" ? replyOption(params) : replyOption;

  const handlers = new Set<(event: FluidEvent) => void>();
  const cancelled = new Set<string>();

  const state: MockWalletState = {
    permissions: new Map(),
    sessions: new Map(),
    conversations: new Map(),
  };

  const calls: FluidRequest[] = [];
  let sessionCounter = 0;

  const emit = (event: FluidEvent): void => {
    for (const handler of handlers) handler(event);
  };

  const requirePermission = (): FluidPermission => {
    const permission = state.permissions.get(origin);
    if (!permission) {
      throw new FluidError(FluidErrorCode.PermissionDenied, `Origin ${origin} is not authorized.`);
    }
    return permission;
  };

  const requireSession = (sessionId: unknown): FluidSession => {
    if (typeof sessionId !== "string") {
      throw new FluidError(FluidErrorCode.InvalidParams, "sessionId is required.");
    }
    const session = state.sessions.get(sessionId);
    if (!session) throw new FluidError(FluidErrorCode.SessionNotFound, "Unknown session.");
    if (session.status !== "active") {
      throw new FluidError(FluidErrorCode.SessionExpired, "Session is no longer active.");
    }
    return session;
  };

  const describeWallet = (): FluidWalletInfo => ({
    name: "Mock Fluid Wallet",
    walletVersion: options.walletVersion ?? "0.0.0-mock",
    protocolVersion: PROTOCOL_VERSION,
    capabilities: [
      "wallet:read",
      "models:list",
      "inference:text",
      "inference:stream",
      "inference:proxy",
    ],
    locked: options.locked ?? false,
    defaultModel: "deepseek-chat",
  });

  const connect = (params: FluidPermissionRequest): FluidPermission => {
    if (permissionMode === "deny") {
      throw new FluidError(FluidErrorCode.Rejected, "The user rejected the connection.");
    }

    const permission: FluidPermission = {
      origin,
      appId: params.appId,
      providers: params.providers ?? [DEFAULT_PROVIDER.id],
      models: params.models,
      capabilities: params.capabilities,
      grantedAt: now(),
      ...(permissionMode === "expired" ? { expiresAt: now() - 1 } : {}),
    };

    state.permissions.set(origin, permission);
    emit({ type: FLUID_EVENTS.PermissionsChanged, payload: { permission } });
    return permission;
  };

  const inference = async (
    params: FluidInferenceParams,
    requestId: string,
  ): Promise<FluidInferenceResult> => {
    requirePermission();
    const session = requireSession(params.sessionId);
    const parsed = parseInferenceParams(params);
    if (!parsed.ok) throw parsed.error;

    const model = params.model ?? session.model ?? "deepseek-chat";
    const chunks = splitReply(reply(params));

    emit({
      type: FLUID_EVENTS.InferenceStart,
      requestId,
      payload: { inferenceId: requestId, sessionId: session.id, model },
    });

    let text = "";
    for (const chunk of chunks) {
      if (cancelled.has(requestId)) {
        emit({
          type: FLUID_EVENTS.InferenceCancelled,
          requestId,
          payload: { inferenceId: requestId, sessionId: session.id },
        });
        throw new FluidError(FluidErrorCode.InferenceCancelled, "Inference cancelled.");
      }
      if (chunkDelayMs > 0) await delay(chunkDelayMs);
      text += chunk;
      emit({
        type: FLUID_EVENTS.InferenceDelta,
        requestId,
        payload: { inferenceId: requestId, text: chunk },
      });
    }

    const result: FluidInferenceResult = {
      id: requestId,
      sessionId: session.id,
      model,
      message: { role: "assistant", content: text },
      finishReason: "stop",
      usage: {
        inputTokens: 0,
        outputTokens: chunks.length,
        totalTokens: chunks.length,
      },
      createdAt: now(),
    };

    emit({ type: FLUID_EVENTS.InferenceDone, requestId, payload: result });
    return result;
  };

  const proxy = async (
    params: FluidProxyParams,
    requestId: string,
  ): Promise<FluidProxyResponse> => {
    requirePermission();
    requireSession(params.sessionId);
    const parsed = parseProxyParams(params);
    if (!parsed.ok) throw parsed.error;

    const answer = await (options.proxy ?? defaultProxy)(params);
    emit({
      type: FLUID_EVENTS.ProxyStart,
      requestId,
      payload: { proxyId: requestId, status: answer.status, contentType: answer.contentType },
    });

    // Split into small frames so reassembly is actually exercised.
    for (const text of answer.body.match(/[\s\S]{1,64}/g) ?? []) {
      if (chunkDelayMs > 0) await delay(chunkDelayMs);
      emit({
        type: FLUID_EVENTS.ProxyChunk,
        requestId,
        payload: { proxyId: requestId, text },
      });
    }

    emit({
      type: FLUID_EVENTS.ProxyEnd,
      requestId,
      payload: { proxyId: requestId, bytes: answer.body.length },
    });

    return { status: answer.status, contentType: answer.contentType, bytes: answer.body.length };
  };

  const dispatch = async (
    request: FluidRequest,
  ): Promise<{ result: unknown } | { error: FluidError }> => {
    const params = (request.params ?? {}) as Record<string, unknown>;

    switch (request.method) {
      case FluidMethod.WalletGetInfo:
        return { result: describeWallet() };

      case FluidMethod.WalletConnect:
        return { result: connect(params as unknown as FluidPermissionRequest) };

      case FluidMethod.WalletDisconnect:
        state.permissions.delete(origin);
        return { result: { ok: true } };

      case FluidMethod.WalletGetPermissions:
        return { result: state.permissions.get(origin) ?? null };

      case FluidMethod.WalletRevoke:
        state.permissions.delete(origin);
        return { result: { revoked: true } };

      case FluidMethod.ProviderList:
        requirePermission();
        return { result: options.providers ?? [DEFAULT_PROVIDER] };

      case FluidMethod.ModelList:
        requirePermission();
        return { result: options.models ?? DEFAULT_MODELS };

      case FluidMethod.SessionCreate: {
        requirePermission();
        sessionCounter += 1;
        const session: FluidSession = {
          id: `session_${sessionCounter}`,
          origin,
          model: (params.model as string | undefined) ?? "deepseek-chat",
          status: "active",
          createdAt: now(),
        };
        state.sessions.set(session.id, session);
        return { result: session };
      }

      case FluidMethod.SessionClose: {
        const session = requireSession(params.sessionId);
        session.status = "closed";
        return { result: { ok: true } };
      }

      case FluidMethod.InferenceCreate:
        return { result: await inference(params as unknown as FluidInferenceParams, request.id) };

      case FluidMethod.InferenceCancel: {
        if (typeof params.inferenceId !== "string") {
          throw new FluidError(FluidErrorCode.InvalidParams, "inferenceId is required.");
        }
        cancelled.add(params.inferenceId);
        return { result: { cancelled: true } };
      }

      case FluidMethod.InferenceProxy:
        return { result: await proxy(params as unknown as FluidProxyParams, request.id) };

      case FluidMethod.ConversationList:
        requirePermission();
        return { result: { items: [] } };

      default:
        throw new FluidError(
          FluidErrorCode.MethodNotFound,
          `Mock wallet does not implement "${request.method}".`,
        );
    }
  };

  const wallet: MockWallet = {
    protocolVersion: PROTOCOL_VERSION,
    walletVersion: options.walletVersion ?? "0.0.0-mock",
    state,
    calls,

    async request(request: FluidRequest): Promise<FluidResponse> {
      calls.push(request);

      const parsed = parseRequest(request);
      if (!parsed.ok) {
        return { jsonrpc: "2.0", id: request.id, error: parsed.error.toJSON() };
      }
      if (!isFluidMethodName(request.method)) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: { code: FluidErrorCode.MethodNotFound, message: "Unknown method." },
        };
      }

      try {
        const outcome = await dispatch(parsed.value);
        if ("error" in outcome) {
          return { jsonrpc: "2.0", id: request.id, error: outcome.error.toJSON() };
        }
        return { jsonrpc: "2.0", id: request.id, result: outcome.result };
      } catch (error) {
        return { jsonrpc: "2.0", id: request.id, error: toFluidError(error).toJSON() };
      }
    },

    onEvent(handler: (event: FluidEvent) => void): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },

    emit,

    grant(permission: FluidPermission): void {
      state.permissions.set(permission.origin, permission);
    },

    dispose(): void {
      handlers.clear();
      state.permissions.clear();
      state.sessions.clear();
    },
  };

  return wallet;
}
