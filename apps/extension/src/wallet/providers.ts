import {
  FluidError,
  FluidErrorCode,
  type FluidModel,
  type FluidModelCapability,
  type FluidProvider,
} from "@fluid-wallet/protocol";
import {
  createOpenAICompatibleProvider,
  type ProviderAdapter,
  type ProviderRecord,
} from "@fluid-wallet/core";
import { browser } from "wxt/browser";

import { db, getSetting, setSetting } from "./db";
import { openString, sealString } from "./vault";

export { PROVIDER_PRESETS, type ProviderInput, type ProviderPreset } from "../presets";
import type { ProviderInput } from "../presets";

const DEFAULT_PROVIDER_SETTING = "wallet.defaultProviderId";

function toPublic(record: ProviderRecord): FluidProvider {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    defaultModel: record.defaultModel,
    models: record.models,
  };
}

export async function listProviders(): Promise<FluidProvider[]> {
  const records = await db().providers.orderBy("updatedAt").reverse().toArray();
  return records.map(toPublic);
}

export async function listRecords(): Promise<ProviderRecord[]> {
  return db().providers.orderBy("updatedAt").reverse().toArray();
}

export async function listModels(providerIds?: string[]): Promise<FluidModel[]> {
  const records = await listRecords();
  const allowed = providerIds?.length ? records.filter((r) => providerIds.includes(r.id)) : records;

  return allowed.flatMap((record) =>
    record.models.map((model) => ({
      id: model,
      providerId: record.id,
      displayName: model,
      capabilities: modelCapabilities(model),
    })),
  );
}

function modelCapabilities(model: string): FluidModelCapability[] {
  const capabilities: FluidModelCapability[] = ["text", "streaming"];
  // Reasoning models in the DeepSeek family still accept tools; everything
  // else is assumed to support the OpenAI-compatible baseline.
  if (/reasoner|o\d|thinking/i.test(model) === false) capabilities.push("tools");
  return capabilities;
}

export async function saveProvider(input: ProviderInput): Promise<ProviderRecord> {
  const baseUrl = input.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/.test(baseUrl) && !/^http:\/\/localhost/.test(baseUrl)) {
    throw new FluidError(FluidErrorCode.InvalidParams, "A provider needs an https base URL.");
  }

  const id = input.id ?? crypto.randomUUID();
  const existing = await db().providers.get(id);
  const now = Date.now();

  const secret = input.apiKey ? await sealString(input.apiKey.trim()) : existing?.secret;
  if (!secret) {
    throw new FluidError(FluidErrorCode.InvalidParams, "An API key is required for a new provider.");
  }

  const record: ProviderRecord = {
    id,
    name: input.name.trim() || id,
    kind: "openai-compatible",
    baseUrl,
    defaultModel: input.defaultModel || input.models[0],
    models: input.models,
    secret,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  await db().providers.put(record);
  if (!(await getSetting<string>(DEFAULT_PROVIDER_SETTING))) {
    await setSetting(DEFAULT_PROVIDER_SETTING, id);
  }
  return record;
}

export async function deleteProvider(id: string): Promise<void> {
  await db().providers.delete(id);
  if ((await getSetting<string>(DEFAULT_PROVIDER_SETTING)) === id) {
    const next = await db().providers.orderBy("updatedAt").last();
    await setSetting(DEFAULT_PROVIDER_SETTING, next?.id ?? null);
  }
}

export async function getDefaultProviderId(): Promise<string | undefined> {
  const configured = await getSetting<string | null>(DEFAULT_PROVIDER_SETTING);
  if (configured) return configured;
  const first = await db().providers.orderBy("updatedAt").last();
  return first?.id;
}

export async function setDefaultProvider(id: string): Promise<void> {
  await setSetting(DEFAULT_PROVIDER_SETTING, id);
}

export interface ProviderCredentials {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
  defaultModel?: string;
}

/**
 * Decrypts a provider's key.
 *
 * Callers must be inside the service worker: this returns plaintext, so it is
 * never reachable from a page or from the options UI.
 */
export async function getProviderCredentials(providerId: string): Promise<ProviderCredentials> {
  const record = await db().providers.get(providerId);
  if (!record) {
    throw new FluidError(FluidErrorCode.ProviderUnavailable, `Unknown provider "${providerId}".`);
  }
  if (!record.secret) {
    throw new FluidError(FluidErrorCode.ProviderUnavailable, `Provider "${providerId}" has no key.`);
  }

  return {
    id: record.id,
    name: record.name,
    baseUrl: record.baseUrl,
    apiKey: await openString(record.secret),
    models: record.models,
    defaultModel: record.defaultModel,
  };
}

/** Builds a live adapter, decrypting the key only inside the service worker. */
export async function getAdapter(providerId: string): Promise<ProviderAdapter> {
  const credentials = await getProviderCredentials(providerId);
  return createOpenAICompatibleProvider({
    id: credentials.id,
    name: credentials.name,
    baseUrl: credentials.baseUrl,
    apiKey: credentials.apiKey,
    models: credentials.models,
    defaultModel: credentials.defaultModel,
  });
}

/**
 * Picks the provider for a request.
 *
 * A model name is not involved here: raw proxy requests name the provider
 * directly, and the origin's grant is the only thing that can widen or narrow
 * the choice.
 */
export async function resolveProviderId(
  requestedProviderId: string | undefined,
  allowedProviderIds: string[],
): Promise<string> {
  const records = await listRecords();
  const allowed = allowedProviderIds.length
    ? records.filter((record) => allowedProviderIds.includes(record.id))
    : records;

  if (allowed.length === 0) {
    throw new FluidError(
      FluidErrorCode.ProviderUnavailable,
      "No provider is available for this connection. Add one in the wallet.",
    );
  }

  const providerId =
    requestedProviderId ?? (await getDefaultProviderId()) ?? allowed[0]?.id;

  if (!providerId || !allowed.some((record) => record.id === providerId)) {
    throw new FluidError(
      FluidErrorCode.PermissionDenied,
      `Provider "${providerId}" was not granted to this connection.`,
    );
  }

  return providerId;
}

/**
 * Why a connection test or a model fetch did not work.
 *
 * These are outcomes, not exceptions. The three cases the UI can act on —
 * missing key, missing host access, provider rejecting the key — have to be
 * told apart and worded in the user's language, and a stack trace in English
 * cannot do that. Anything genuinely unexpected still throws.
 */
export type ProbeFailure =
  | "no-key"
  | "invalid-url"
  | "no-access"
  | "unauthorized"
  | "not-found"
  | "timeout"
  | "network"
  | "no-model"
  | "http";

export interface ProbeError {
  ok: false;
  reason: ProbeFailure;
  /** Present for `http`: the status the provider answered with. */
  status?: number;
  /** Provider-supplied detail, trimmed. Diagnostic only, never translated. */
  detail?: string;
}

/** What the form holds: a saved provider, or a draft that is not saved yet. */
export interface ProbeInput {
  id?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export type TestResult = { ok: true; model: string; latencyMs: number } | ProbeError;

export type RemoteModels =
  | { ok: true; host: string; models: string[]; latencyMs: number }
  | (ProbeError & { host?: string });

const PROBE_TIMEOUT_MS = 20_000;

interface ProbeTarget {
  id: string;
  baseUrl: string;
  apiKey: string;
  origin: string;
  models: string[];
  defaultModel?: string;
}

/**
 * Fills in whatever the form left out from the stored provider.
 *
 * A draft and a saved provider go through the same door on purpose: testing a
 * key you have not saved yet is the whole point of the button next to the field.
 * The key is only ever read here, inside the service worker, and only to
 * authenticate the probe.
 */
async function resolveProbe(input: ProbeInput): Promise<ProbeTarget | ProbeError> {
  const record = input.id ? await db().providers.get(input.id) : undefined;
  if (input.id && !record) {
    throw new FluidError(FluidErrorCode.ProviderUnavailable, "Unknown provider.");
  }

  const baseUrl = (input.baseUrl?.trim() || record?.baseUrl || "").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+/.test(baseUrl) && !/^http:\/\/localhost/.test(baseUrl)) {
    return { ok: false, reason: "invalid-url" };
  }

  const apiKey = input.apiKey?.trim() || (record?.secret ? await openString(record.secret) : "");
  if (!apiKey) return { ok: false, reason: "no-key" };

  const origin = new URL(baseUrl).origin;
  if (!(await hasHostAccess(origin))) return { ok: false, reason: "no-access" };

  return {
    id: record?.id ?? "draft",
    baseUrl,
    apiKey,
    origin,
    models: record?.models ?? [],
    defaultModel: record?.defaultModel,
  };
}

/**
 * Host access lives in the browser, so the wallet has to ask it rather than
 * assume: `fetch` from a worker without the grant fails as an opaque
 * "Failed to fetch", which reads as a network problem and sends the user
 * looking in the wrong place.
 */
async function hasHostAccess(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

function failure(status: number, detail?: string): ProbeError {
  const trimmed = detail?.slice(0, 300).trim() || undefined;
  if (status === 401 || status === 403) return { ok: false, reason: "unauthorized", status, detail: trimmed };
  if (status === 404) return { ok: false, reason: "not-found", status, detail: trimmed };
  return { ok: false, reason: "http", status, detail: trimmed };
}

function networkFailure(cause: unknown): ProbeError {
  if (cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")) {
    return { ok: false, reason: "timeout" };
  }
  if (cause instanceof FluidError && typeof cause.code === "number" && cause.code === FluidErrorCode.Unauthorized) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: false, reason: "network", detail: cause instanceof Error ? cause.message : undefined };
}

/**
 * One token of output: it proves the URL, the key and the model id all resolve,
 * without spending the user's budget on a real answer.
 */
export async function testProvider(input: ProbeInput): Promise<TestResult> {
  const target = await resolveProbe(input);
  if ("ok" in target) return target;

  const model = input.model?.trim() || target.defaultModel || target.models[0];
  if (!model) return { ok: false, reason: "no-model" };

  const adapter = createOpenAICompatibleProvider({
    id: target.id,
    name: target.id,
    baseUrl: target.baseUrl,
    apiKey: target.apiKey,
    models: target.models.length ? target.models : [model],
    defaultModel: model,
  });

  const started = Date.now();
  try {
    await adapter.chat({
      model,
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 1,
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof FluidError && cause.code !== FluidErrorCode.Unauthorized) {
      // The adapter turns a non-2xx into a FluidError without the status, so the
      // status is recovered from the message it builds: `… responded with 404.`
      const status = /responded with (\d{3})/.exec(cause.message)?.[1];
      return status
        ? failure(Number(status), typeof cause.data === "string" ? cause.data : undefined)
        : { ok: false, reason: "network", detail: cause.message };
    }
    return networkFailure(cause);
  }

  return { ok: true, model, latencyMs: Date.now() - started };
}

/**
 * The provider's own model list.
 *
 * `GET {baseUrl}/models` is the one non-chat endpoint allowed through the raw
 * proxy, and the same rule applies here: it is a read of the catalogue, not a
 * reach into the account. Providers that do not expose it answer 404, which the
 * UI reports as "type the ids by hand" rather than as a failure.
 */
export async function listRemoteModels(input: ProbeInput): Promise<RemoteModels> {
  const target = await resolveProbe(input);
  if ("ok" in target) return target;

  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${target.baseUrl}/models`, {
      headers: { authorization: `Bearer ${target.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (cause) {
    return { ...networkFailure(cause), host: new URL(target.baseUrl).host };
  }

  const host = new URL(target.baseUrl).host;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    return { ...failure(response.status, detail), host };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, reason: "http", status: response.status, host };
  }

  const ids = (payload as { data?: Array<{ id?: unknown }> })?.data;
  if (!Array.isArray(ids)) return { ok: false, reason: "not-found", host };

  const models = [...new Set(ids.map((entry) => entry?.id).filter((id): id is string => typeof id === "string"))].sort();

  return { ok: true, host, models, latencyMs: Date.now() - started };
}

export interface Route {
  providerId: string;
  model: string;
  adapter: ProviderAdapter;
}

/**
 * Resolves the provider and model for a request.
 *
 * `provider:model` is accepted as an escape hatch, otherwise the model is
 * matched against the configured providers and falls back to the default one.
 */
export async function resolveRoute(
  requestedModel: string | undefined,
  allowedProviderIds: string[],
): Promise<Route> {
  const records = await listRecords();
  const allowed = allowedProviderIds.length
    ? records.filter((record) => allowedProviderIds.includes(record.id))
    : records;

  if (allowed.length === 0) {
    throw new FluidError(
      FluidErrorCode.ProviderUnavailable,
      "No provider is available for this connection. Add one in the wallet.",
    );
  }

  let providerId: string | undefined;
  let model: string | undefined;

  if (requestedModel?.includes(":")) {
    const [provider, ...rest] = requestedModel.split(":");
    providerId = provider;
    model = rest.join(":");
  } else if (requestedModel) {
    model = requestedModel;
    providerId = allowed.find((record) => record.models.includes(requestedModel))?.id;
  }

  providerId ??= (await getDefaultProviderId()) ?? allowed[0]?.id;
  const record = allowed.find((candidate) => candidate.id === providerId);
  if (!record) {
    throw new FluidError(
      FluidErrorCode.PermissionDenied,
      `Provider "${providerId}" was not granted to this connection.`,
    );
  }

  model ??= record.defaultModel ?? record.models[0];
  if (!model) {
    throw new FluidError(FluidErrorCode.InvalidParams, "This provider has no model configured.");
  }
  if (record.models.length > 0 && !record.models.includes(model)) {
    throw new FluidError(
      FluidErrorCode.InvalidParams,
      `Model "${model}" is not configured on provider "${record.id}".`,
    );
  }

  return { providerId: record.id, model, adapter: await getAdapter(record.id) };
}
