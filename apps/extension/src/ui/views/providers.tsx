import { useEffect, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";

import { PROVIDER_PRESETS, type ProviderInput } from "../../presets";
import type { ProviderView } from "../../wallet/ui";
import { Card, ErrorText, Field, send, timeAgo } from "../components";
import { openGrantWindow } from "../windows";

interface Draft {
  id?: string;
  name: string;
  baseUrl: string;
  models: string;
  defaultModel: string;
  apiKey: string;
}

const EMPTY: Draft = {
  name: PROVIDER_PRESETS[0]?.name ?? "",
  baseUrl: PROVIDER_PRESETS[0]?.baseUrl ?? "",
  models: (PROVIDER_PRESETS[0]?.models ?? []).join(", "),
  defaultModel: PROVIDER_PRESETS[0]?.defaultModel ?? "",
  apiKey: "",
};

export function ProvidersView() {
  const [providers, setProviders] = useState<ProviderView[]>([]);
  // Host permissions live in the browser, not in the wallet, so they are read
  // back on every load: the user may have revoked one from chrome://extensions.
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    try {
      const next = await send<ProviderView[]>({ type: "ui:providers" });
      setProviders(next);
      setAccess(await accessOf(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load providers.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!draft) return;
    setError(null);
    setNotice(null);

    const input: ProviderInput = {
      id: draft.id,
      name: draft.name,
      baseUrl: draft.baseUrl,
      models: draft.models
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean),
      defaultModel: draft.defaultModel.trim() || undefined,
      apiKey: draft.apiKey.trim() || undefined,
    };

    setBusy(true);
    try {
      // Save before asking for anything. Granting host access needs a window of
      // its own — the prompt would otherwise take focus and destroy the popup
      // mid-save — so the provider has to exist on its own by then.
      const saved = await send<ProviderView[]>({ type: "ui:saveProvider", input });
      setProviders(saved);
      setAccess(await accessOf(saved));
      setDraft(null);
      setNotice("Provider saved.");

      const origin = providerOrigin(input.baseUrl);
      if (origin && !(await hasAccess(origin))) openGrantWindow(origin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the provider.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      setProviders(await send<ProviderView[]>({ type: "ui:deleteProvider", id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the provider.");
    }
  };

  const test = async (id: string): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const result = await send<{ ok: boolean; model: string }>({ type: "ui:testProvider", id });
      setNotice(`Connected. ${result.model} answered.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The provider did not answer.");
    }
  };

  return (
    <>
      <Card
        title="Model providers"
        description="Credentials are encrypted with your master password and stay on this device."
      >
        {providers.length === 0 ? (
          <p className="empty">No provider yet. Add your DeepSeek key to get started.</p>
        ) : (
          providers.map((provider) => (
            <div className="item" key={provider.id}>
              <div>
                <div className="item-title">
                  {provider.name}{" "}
                  {provider.isDefault ? <span className="badge badge-ok">default</span> : null}{" "}
                  {access[provider.id] === false ? (
                    <span className="badge badge-warn">no access</span>
                  ) : null}
                </div>
                <div className="mono">{provider.baseUrl}</div>
                <div className="muted">
                  {provider.models.join(" · ") || "no models"} · saved {timeAgo(provider.updatedAt)}
                </div>
              </div>
              <div className="actions">
                {access[provider.id] === false ? (
                  <button
                    className="btn"
                    onClick={() => {
                      const origin = providerOrigin(provider.baseUrl);
                      if (origin) openGrantWindow(origin);
                    }}
                  >
                    Grant access
                  </button>
                ) : null}
                <button className="btn" onClick={() => void test(provider.id)}>
                  Test
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    setDraft({
                      id: provider.id,
                      name: provider.name,
                      baseUrl: provider.baseUrl,
                      models: provider.models.join(", "),
                      defaultModel: provider.defaultModel ?? "",
                      apiKey: "",
                    })
                  }
                >
                  Edit
                </button>
                {provider.isDefault ? null : (
                  <button
                    className="btn"
                    onClick={() =>
                      void send<ProviderView[]>({
                        type: "ui:setDefaultProvider",
                        id: provider.id,
                      }).then(setProviders)
                    }
                  >
                    Make default
                  </button>
                )}
                <button className="btn btn-danger" onClick={() => void remove(provider.id)}>
                  Remove
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      {notice ? <p className="badge badge-ok">{notice}</p> : null}
      <ErrorText error={error} />

      {draft ? (
        <Card title={draft.id ? "Edit provider" : "Add provider"}>
          <form className="stack" onSubmit={save}>
            {draft.id ? null : (
              <Field label="Preset">
                <select
                  className="input"
                  onChange={(event) => {
                    const preset = PROVIDER_PRESETS.find(
                      (candidate) => candidate.key === event.target.value,
                    );
                    if (!preset) {
                      setDraft({ ...draft, name: "", baseUrl: "https://", models: "" });
                      return;
                    }
                    setDraft({
                      ...draft,
                      name: preset.name,
                      baseUrl: preset.baseUrl,
                      models: preset.models.join(", "),
                      defaultModel: preset.defaultModel,
                    });
                  }}
                >
                  {PROVIDER_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Name">
              <input
                className="input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>

            <Field label="Base URL" hint="OpenAI-compatible root, without /chat/completions.">
              <input
                className="input"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </Field>

            <Field label="Models" hint="Comma separated.">
              <input
                className="input"
                value={draft.models}
                onChange={(event) => setDraft({ ...draft, models: event.target.value })}
              />
            </Field>

            <Field label="Default model">
              <input
                className="input"
                value={draft.defaultModel}
                onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}
              />
            </Field>

            <Field
              label="API key"
              hint={draft.id ? "Leave empty to keep the current key." : "Stored encrypted."}
            >
              <input
                className="input"
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </Field>

            <div className="actions">
              <button className="btn btn-primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save provider"}
              </button>
              <button className="btn" type="button" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      ) : (
        <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY })}>
          Add provider
        </button>
      )}
    </>
  );
}

/** `https://api.deepseek.com` — the unit Chrome grants host access to. */
function providerOrigin(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

async function hasAccess(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

async function accessOf(providers: ProviderView[]): Promise<Record<string, boolean>> {
  const entries = await Promise.all(
    providers.map(async (provider) => {
      const origin = providerOrigin(provider.baseUrl);
      return [provider.id, origin ? await hasAccess(origin) : false] as const;
    }),
  );
  return Object.fromEntries(entries);
}
