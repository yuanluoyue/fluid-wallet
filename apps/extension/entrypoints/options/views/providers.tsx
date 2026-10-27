import { useEffect, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";

import { PROVIDER_PRESETS, type ProviderInput } from "../../../src/presets";
import type { ProviderView } from "../../../src/wallet/ui";
import { Card, ErrorText, Field, send, timeAgo } from "../components";

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
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    try {
      setProviders(await send<ProviderView[]>({ type: "ui:providers" }));
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

    // Must run inside the click gesture, before any await, or Chrome refuses it.
    const origin = originPattern(draft.baseUrl);
    if (origin) {
      const granted = await browser.permissions.request({ origins: [origin] });
      if (!granted) {
        setError(`The wallet needs access to ${origin} to call this provider.`);
        return;
      }
    }

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
      setProviders(await send<ProviderView[]>({ type: "ui:saveProvider", input }));
      setDraft(null);
      setNotice("Provider saved.");
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
                  {provider.isDefault ? <span className="badge badge-ok">default</span> : null}
                </div>
                <div className="mono">{provider.baseUrl}</div>
                <div className="muted">
                  {provider.models.join(" · ") || "no models"} · saved {timeAgo(provider.updatedAt)}
                </div>
              </div>
              <div className="actions">
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

function originPattern(baseUrl: string): string | null {
  try {
    return `${new URL(baseUrl).origin}/*`;
  } catch {
    return null;
  }
}
