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

/** One-token round trip so the UI can tell "wrong key" from "wrong URL". */
export async function testProvider(providerId: string): Promise<{ ok: true; model: string }> {
  const record = await db().providers.get(providerId);
  if (!record) throw new FluidError(FluidErrorCode.ProviderUnavailable, "Unknown provider.");
  const adapter = await getAdapter(providerId);
  const model = record.defaultModel ?? record.models[0];
  if (!model) throw new FluidError(FluidErrorCode.InvalidParams, "This provider has no models.");

  // One token of output is enough: it proves the URL, the key and the model id
  // all resolve, without spending the user's budget on a real answer.
  await adapter.chat({
    model,
    messages: [{ role: "user", content: "ping" }],
    maxTokens: 1,
  });
  return { ok: true, model };
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
