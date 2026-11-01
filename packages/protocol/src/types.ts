import type { FluidErrorShape } from "./errors";

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export type FluidJsonRpcVersion = "2.0";

export interface FluidRequest<TParams = unknown> {
  jsonrpc: FluidJsonRpcVersion;
  id: string;
  method: string;
  params?: TParams;
}

export interface FluidResponse<TResult = unknown> {
  jsonrpc: FluidJsonRpcVersion;
  id: string;
  result?: TResult;
  error?: FluidErrorShape;
}

export interface FluidEvent<TPayload = unknown> {
  type: string;
  /** Present when the event belongs to a specific request (streaming, tools). */
  requestId?: string;
  payload: TPayload;
}

// ---------------------------------------------------------------------------
// Capabilities and permissions
// ---------------------------------------------------------------------------

export const FLUID_CAPABILITIES = [
  "wallet:read",
  "models:list",
  "inference:text",
  "inference:stream",
  "inference:tools",
  "inference:proxy",
  "conversation:read",
  "conversation:write",
  "activity:read",
  "wallet:manage",
  "provider:manage",
] as const;

export type FluidCapability = (typeof FLUID_CAPABILITIES)[number];

/**
 * Capabilities a wallet is allowed to hand to a web origin.
 *
 * `wallet:manage` and `provider:manage` are intentionally excluded: they change
 * the user's configuration and must stay in the wallet UI.
 *
 * `inference:proxy` is broader than `inference:text` — it lets an app speak the
 * provider's raw HTTP API instead of the structured message shape, which is what
 * makes drop-in provider SDKs possible. It is grantable, but never granted by
 * default: the approval dialog says so in plain words.
 */
export const GRANTABLE_CAPABILITIES = [
  "wallet:read",
  "models:list",
  "inference:text",
  "inference:stream",
  "inference:tools",
  "inference:proxy",
  "conversation:read",
  "conversation:write",
  "activity:read",
] as const satisfies readonly FluidCapability[];

export function isGrantableCapability(value: unknown): value is FluidCapability {
  return (GRANTABLE_CAPABILITIES as readonly unknown[]).includes(value);
}

/** What a page asks for when it calls `wallet.connect`. */
export interface FluidPermissionRequest {
  appId?: string;
  appName?: string;
  /** Human-readable justification shown in the approval dialog. */
  reason?: string;
  providers?: string[];
  /** Restricts the grant to an explicit model list; omit for "any allowed model". */
  models?: string[];
  capabilities: FluidCapability[];
}

/** What the wallet actually granted. Always resolved from the sender origin. */
export interface FluidPermission {
  origin: string;
  appId?: string;
  providers: string[];
  models?: string[];
  capabilities: FluidCapability[];
  grantedAt: number;
  expiresAt?: number;
}

export function hasCapability(
  permission: FluidPermission | null | undefined,
  capability: FluidCapability,
): boolean {
  return permission?.capabilities.includes(capability) ?? false;
}

export function isPermissionExpired(permission: FluidPermission, now = Date.now()): boolean {
  return permission.expiresAt !== undefined && permission.expiresAt <= now;
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export interface FluidWalletInfo {
  name: string;
  walletVersion: string;
  protocolVersion: string;
  capabilities: FluidCapability[];
  /** A locked wallet can describe itself but cannot infer or reveal secrets. */
  locked: boolean;
  defaultModel?: string;
}

/**
 * The caller's own consumption, so an app can say "12 requests left today"
 * instead of surfacing a failure the user cannot act on.
 *
 * Named `FluidQuota`, not `FluidUsage`: "usage" already means token counts in
 * an inference result, and the two numbers answer different questions.
 */
export interface FluidQuota {
  /** Requests charged to this origin today (UTC). */
  used: number;
  /** Daily cap the wallet enforces; `0` means unlimited. */
  limit: number;
  /** The UTC day being counted, `YYYY-MM-DD`. */
  day: string;
  /** Epoch ms when the counter rolls over. */
  resetsAt: number;
}

// ---------------------------------------------------------------------------
// Providers and models
// ---------------------------------------------------------------------------

export type FluidProviderKind = "openai-compatible";

export interface FluidProvider {
  id: string;
  name: string;
  kind: FluidProviderKind;
  defaultModel?: string;
  models: string[];
}

export type FluidModelCapability = "text" | "streaming" | "tools" | "json" | "reasoning" | "vision";

export interface FluidModelPricing {
  inputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  currency?: string;
}

export interface FluidModel {
  id: string;
  providerId: string;
  displayName: string;
  capabilities: FluidModelCapability[];
  contextWindow?: number;
  pricing?: FluidModelPricing;
}

export function modelSupports(model: FluidModel, capability: FluidModelCapability): boolean {
  return model.capabilities.includes(capability);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type FluidSessionStatus = "active" | "closed" | "expired";

export interface FluidSession {
  id: string;
  origin: string;
  appId?: string;
  model?: string;
  status: FluidSessionStatus;
  createdAt: number;
  expiresAt?: number;
}

export interface FluidCreateSessionParams {
  model?: string;
  /** Whether the wallet may persist this conversation locally. */
  persist?: boolean;
  metadata?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Messages and tools
// ---------------------------------------------------------------------------

export type FluidRole = "system" | "user" | "assistant" | "tool";

export type FluidContentPart = { type: "text"; text: string } | { type: "image"; url: string };

export type FluidMessageContent = string | FluidContentPart[];

export interface FluidToolCall {
  id: string;
  name: string;
  arguments: unknown;
}

export interface FluidToolResult {
  toolCallId: string;
  result?: unknown;
  error?: string;
}

export interface FluidMessage {
  id?: string;
  role: FluidRole;
  content: FluidMessageContent;
  name?: string;
  toolCallId?: string;
  /** Assistant messages only: tool calls the model wants the app to run. */
  toolCalls?: FluidToolCall[];
  createdAt?: number;
}

export type FluidJsonSchema = Record<string, unknown>;

export type FluidToolRisk = "low" | "medium" | "high";

export interface FluidToolDefinition {
  name: string;
  description?: string;
  /** JSON Schema for the arguments object. Never contains executable code. */
  parameters: FluidJsonSchema;
  /** High-risk tools may require an explicit user confirmation per call. */
  risk?: FluidToolRisk;
}

export function messageToText(message: FluidMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
}

// ---------------------------------------------------------------------------
// Inference
// ---------------------------------------------------------------------------

export type FluidFinishReason =
  "stop" | "length" | "tool-calls" | "content-filter" | "cancelled" | "error";

export interface FluidUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type FluidToolChoice = "auto" | "none" | "required" | { type: "tool"; name: string };

export interface FluidInferenceParams {
  sessionId: string;
  model?: string;
  messages: FluidMessage[];
  stream?: boolean;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  stopSequences?: string[];
  tools?: FluidToolDefinition[];
  toolChoice?: FluidToolChoice;
  metadata?: Record<string, string>;
}

export interface FluidInferenceResult {
  id: string;
  sessionId: string;
  model: string;
  message: FluidMessage;
  finishReason: FluidFinishReason;
  usage?: FluidUsage;
  toolCalls?: FluidToolCall[];
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Raw provider requests
// ---------------------------------------------------------------------------

export type FluidProxyMethod = "GET" | "POST";

/**
 * Headers a page is allowed to set on a proxied request.
 *
 * An allow-list rather than a deny-list, because the interesting failure is the
 * header nobody thought about: `authorization` and `x-api-key` carry the user's
 * credential and must never arrive from a page, and `host`, `origin` or a
 * `content-length` the wallet cannot honour describe a request the wallet is
 * not actually making.
 *
 * What is left is the set a real provider SDK needs in order to be understood
 * by its own API: which format the body is in, and which version of that
 * format the caller expects. `anthropic-*` is here so the raw proxy is not
 * quietly OpenAI-only — the path is already format-agnostic, and refusing the
 * one header that identifies an Anthropic request would make that a lie.
 */
export const FLUID_PROXY_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "anthropic-version",
  "anthropic-beta",
  "anthropic-dangerous-direct-browser-access",
  "openai-organization",
  "openai-project",
  "openai-beta",
] as const;

export type FluidProxyRequestHeader = (typeof FLUID_PROXY_REQUEST_HEADERS)[number];

/**
 * Response headers that never cross back to the page.
 *
 * The body is re-framed on the way through: it is decoded to text and
 * re-encoded, and it is delivered as a stream. So `content-encoding` and
 * `content-length` describe the provider's wire format, not the one the page
 * receives, and a `Response` carrying either is a `Response` that lies.
 * `set-cookie` is dropped because the page's origin is not the provider's and
 * the wallet is not a cookie jar.
 */
export const FLUID_PROXY_RESPONSE_HEADER_DENYLIST = [
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "set-cookie",
  "set-cookie2",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
] as const;

/**
 * A request the page wants the wallet to make on its behalf.
 *
 * The page controls the path only. The scheme, host and API key always come
 * from the provider the wallet has configured, so a compromised page cannot
 * point the wallet at an arbitrary server.
 */
export interface FluidProxyParams {
  sessionId: string;
  /** Provider to route through. Defaults to the wallet's default provider. */
  providerId?: string;
  method?: FluidProxyMethod;
  /** Path below the provider base URL, including its `/v1` prefix if it has one. */
  path: string;
  /** Raw request body, already serialised by the app. */
  body?: string;
  /**
   * Headers the wallet may forward, from `FLUID_PROXY_REQUEST_HEADERS`.
   *
   * Anything outside that list is rejected by validation rather than silently
   * dropped: an app that thinks it set `x-api-key` should find out at the call
   * site, not by watching its requests come back 401.
   */
  headers?: Record<string, string>;
}

export interface FluidProxyResponse {
  status: number;
  contentType: string;
  bytes: number;
  /** Set when the stream stopped early because the app cancelled it. */
  truncated?: boolean;
}

// ---------------------------------------------------------------------------
// Conversations and activity
// ---------------------------------------------------------------------------

export interface FluidConversation {
  id: string;
  origin: string;
  appId?: string;
  title?: string;
  model?: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface FluidConversationDetail extends FluidConversation {
  messages: FluidMessage[];
}

export type FluidActivityStatus = "success" | "error" | "cancelled" | "timeout";

export interface FluidActivityEntry {
  id: string;
  origin: string;
  appId?: string;
  providerId: string;
  model: string;
  status: FluidActivityStatus;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  usage?: FluidUsage;
  errorCode?: number;
}

export interface FluidPage<TItem> {
  items: TItem[];
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export const FLUID_EVENTS = {
  InferenceStart: "inference.start",
  InferenceDelta: "inference.delta",
  InferenceToolCall: "inference.tool-call",
  InferenceDone: "inference.done",
  InferenceError: "inference.error",
  InferenceCancelled: "inference.cancelled",
  ProxyStart: "proxy.start",
  ProxyChunk: "proxy.chunk",
  ProxyEnd: "proxy.end",
  ProxyError: "proxy.error",
  PermissionsChanged: "permissions.changed",
  WalletLocked: "wallet.locked",
  WalletUnlocked: "wallet.unlocked",
  WalletDisconnected: "wallet.disconnected",
} as const;

export type FluidEventType = (typeof FLUID_EVENTS)[keyof typeof FLUID_EVENTS];

export interface FluidInferenceStartPayload {
  inferenceId: string;
  sessionId: string;
  model: string;
}

export interface FluidInferenceDeltaPayload {
  inferenceId: string;
  text: string;
}

export interface FluidInferenceToolCallPayload {
  inferenceId: string;
  toolCall: FluidToolCall;
}

export type FluidInferenceDonePayload = FluidInferenceResult;

export interface FluidInferenceErrorPayload {
  inferenceId: string;
  error: FluidErrorShape;
}

export interface FluidInferenceCancelledPayload {
  inferenceId: string;
  sessionId: string;
}

export interface FluidPermissionsChangedPayload {
  permission: FluidPermission | null;
}

/**
 * Head of a proxied response.
 *
 * Sent before any body chunk so the app can build a `Response` with the real
 * status and content type, exactly as it would with a direct `fetch`.
 */
export interface FluidProxyStartPayload {
  proxyId: string;
  status: number;
  contentType: string;
  /**
   * Response headers worth keeping, already filtered by the wallet.
   *
   * Without these a `Response` built by the page carries a status and nothing
   * else, so `retry-after` never reaches the caller — which is how a client
   * that knows how to back off from a 429 stops backing off, and how an agent
   * turns a rate limit into a hard failure.
   *
   * Optional: an older wallet sends none, and the SDK must not depend on them.
   */
  headers?: Record<string, string>;
}

export interface FluidProxyChunkPayload {
  proxyId: string;
  /** UTF-8 text. Binary bodies are out of scope. */
  text: string;
}

export interface FluidProxyEndPayload {
  proxyId: string;
  bytes: number;
  truncated?: boolean;
}

export interface FluidProxyErrorPayload {
  proxyId: string;
  error: FluidErrorShape;
}

/** Every event the SDK understands, discriminated by `type`. */
export type FluidStreamEvent =
  | (FluidEvent<FluidInferenceStartPayload> & { type: typeof FLUID_EVENTS.InferenceStart })
  | (FluidEvent<FluidInferenceDeltaPayload> & { type: typeof FLUID_EVENTS.InferenceDelta })
  | (FluidEvent<FluidInferenceToolCallPayload> & { type: typeof FLUID_EVENTS.InferenceToolCall })
  | (FluidEvent<FluidInferenceDonePayload> & { type: typeof FLUID_EVENTS.InferenceDone })
  | (FluidEvent<FluidInferenceErrorPayload> & { type: typeof FLUID_EVENTS.InferenceError })
  | (FluidEvent<FluidInferenceCancelledPayload> & { type: typeof FLUID_EVENTS.InferenceCancelled })
  | (FluidEvent<FluidProxyStartPayload> & { type: typeof FLUID_EVENTS.ProxyStart })
  | (FluidEvent<FluidProxyChunkPayload> & { type: typeof FLUID_EVENTS.ProxyChunk })
  | (FluidEvent<FluidProxyEndPayload> & { type: typeof FLUID_EVENTS.ProxyEnd })
  | (FluidEvent<FluidProxyErrorPayload> & { type: typeof FLUID_EVENTS.ProxyError });
