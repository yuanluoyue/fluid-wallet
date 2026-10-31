import {
  FluidError,
  FluidErrorCode,
  resolveProviderUrl,
  type FluidCapability,
} from "@fluid-wallet/protocol";

import { DEFAULT_CONNECT_CAPABILITIES, FluidClient } from "./client";
import { createFluidFetch, type FluidFetch } from "./fetch";

/** The only provider v0.1 claims to support out of the box. */
export const DEFAULT_DEV_BASE_URL = "https://api.deepseek.com/v1";
export const DEFAULT_PROVIDER_ID = "deepseek";

export interface ConnectFluidOptions {
  appId?: string;
  appName?: string;
  /** Restrict the grant to one provider. Omit to let the user pick. */
  providerId?: string;
  model?: string;
  /** Overrides the default capabilities — pair this with `inference:proxy`. */
  capabilities?: FluidCapability[];
  /** Shown in the approval window. */
  reason?: string;
  /** Reuse a client, for apps that already render wallet state. */
  client?: FluidClient;

  /**
   * Development fallback, used only when no wallet answers.
   *
   * Prefer `FLUID_DEV_API_KEY` in `.env.local` over hardcoding a key. This is a
   * convenience for local work, never a security boundary: a production build
   * refuses it outright.
   */
  devApiKey?: string;
  devBaseUrl?: string;
  devModel?: string;
  devFetch?: typeof fetch;
}

export interface FluidHandle {
  /** `wallet` means requests are proxied and the key never reaches the page. */
  mode: "wallet" | "dev";
  providerId: string;
  model?: string;
  sessionId?: string;
  client?: FluidClient;
  /** A `fetch` that works with the provider's own SDK. */
  createFetch(): FluidFetch;
  disconnect(): Promise<void>;
}

/**
 * One call that makes an app wallet-aware.
 *
 * With the extension installed this connects, asks for consent, opens a session
 * and hands back a `fetch`. Without it, and only when a development key is
 * available, it returns the same shape pointing straight at the provider — so
 * local work does not need the wallet, and nothing else in the app changes.
 */
export async function connectFluid(options: ConnectFluidOptions = {}): Promise<FluidHandle> {
  const client =
    options.client ??
    new FluidClient({ appId: options.appId, appName: options.appName });

  const info = await client.detect();

  if (info) {
    if (info.locked) {
      throw new FluidError(
        FluidErrorCode.Locked,
        "Fluid Wallet is locked. Unlock it from the extension, then retry.",
      );
    }

    const permission = await client.connect({
      appId: options.appId,
      appName: options.appName,
      capabilities: options.capabilities ?? [...DEFAULT_CONNECT_CAPABILITIES, "inference:proxy"],
      ...(options.providerId ? { providers: [options.providerId] } : {}),
      ...(options.model ? { models: [options.model] } : {}),
      ...(options.reason ? { reason: options.reason } : {}),
    });

    const session = await client.createSession(options.model ? { model: options.model } : {});
    const providerId = options.providerId ?? permission.providers[0] ?? DEFAULT_PROVIDER_ID;

    return {
      mode: "wallet",
      providerId,
      model: options.model ?? session.model,
      sessionId: session.id,
      client,
      createFetch: () =>
        createFluidFetch(client, {
          sessionId: session.id,
          ...(options.providerId ? { providerId: options.providerId } : {}),
        }),
      disconnect: () => client.disconnect(),
    };
  }

  // Nothing answered — but "nothing answered" hides three very different
  // pages, and the fix differs for each. A bridge means the extension did
  // inject here; a bridge whose relay never announced itself means the tab
  // predates the extension's last reload; no bridge at all means no extension.
  // The page can tell these apart, so the distinction travels with the error
  // instead of being guessed at by whoever reads the message.
  const injected = client.transportKind === "bridge";
  const relayGone = injected && client.diagnostics?.relay === false;
  const reason = !injected ? "not-injected" : relayGone ? "no-relay" : "worker-silent";

  // Whatever went wrong, the next person to look at this needs the numbers,
  // not a story. They travel with the error so a page can print them and a bug
  // report can quote them without anyone opening DevTools.
  const evidence = {
    reason,
    transport: client.transportKind,
    attempts: client.detectAttempts,
    ...(client.diagnostics ? { diagnostics: client.diagnostics } : {}),
  };
  console.debug("[fluid-wallet] wallet unreachable", evidence);

  const apiKey = options.devApiKey ?? env("FLUID_DEV_API_KEY");
  if (!apiKey) {
    throw new FluidError(
      FluidErrorCode.NotInstalled,
      relayGone
        ? "Fluid Wallet was reloaded after this page opened, so the part of it that talks to the extension is gone."
        : injected
          ? "Fluid Wallet is injected in this page, but its background worker never answered."
          : "No Fluid Wallet bridge exists in this page: the extension is not loaded, or it did not inject here.",
      evidence,
    );
  }
  if (isProduction()) {
    throw new FluidError(
      FluidErrorCode.NotInstalled,
      "Refusing to fall back to a development API key in a production build.",
    );
  }

  const baseUrl = options.devBaseUrl ?? DEFAULT_DEV_BASE_URL;

  return {
    mode: "dev",
    providerId: options.providerId ?? DEFAULT_PROVIDER_ID,
    model: options.devModel ?? options.model,
    createFetch: () => createDevFetch({ apiKey, baseUrl, ...(options.devFetch ? { fetchImpl: options.devFetch } : {}) }),
    disconnect: async () => undefined,
  };
}

/**
 * The development counterpart of the proxy path.
 *
 * It resolves URLs with the same helper the wallet uses, so a path that works
 * here works after the wallet is installed.
 */
export function createDevFetch(config: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}): FluidFetch {
  const doFetch = config.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!doFetch) {
    throw new FluidError(FluidErrorCode.NotInstalled, "No fetch implementation is available.");
  }

  return async (input, init = {}) => {
    const url = readUrl(input);
    const target = resolveProviderUrl(config.baseUrl, `${url.pathname}${url.search}`);

    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${config.apiKey}`);
    if (init.body !== undefined && init.body !== null && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    return doFetch(target, { ...init, headers });
  };
}

function readUrl(input: string | URL | Request): URL {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, "https://provider.invalid");
}

function env(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

function isProduction(): boolean {
  return env("NODE_ENV") === "production";
}
