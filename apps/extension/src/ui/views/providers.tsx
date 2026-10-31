import { useEffect, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";

import { useI18n, type TFunction } from "../../i18n/react";
import { PROVIDER_PRESETS, type ProviderInput } from "../../presets";
import type { ProbeError, RemoteModels, TestResult } from "../../wallet/providers";
import type { ProviderView } from "../../wallet/ui";
import { Card, ErrorText, Field, send, useFormatters } from "../components";
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

/** Which control is waiting on the provider right now: a row id, or the draft. */
type Busy = { kind: "test" | "models"; target: string } | null;

/** What a probe needs: a saved provider id, or the values still in the form. */
interface ProbeDraft {
  id?: string;
  baseUrl: string;
  apiKey?: string;
  model?: string;
}

export function ProvidersView() {
  const { t } = useI18n();
  const { timeAgo } = useFormatters();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  // Host permissions live in the browser, not in the wallet, so they are read
  // back on every load: the user may have revoked one from chrome://extensions.
  const [access, setAccess] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set when the last probe failed because the browser holds no host grant:
  // the fix is a button, not a sentence.
  const [needGrant, setNeedGrant] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [saving, setSaving] = useState(false);
  const [remote, setRemote] = useState<RemoteModels | null>(null);

  const load = async (): Promise<void> => {
    try {
      const next = await send<ProviderView[]>({ type: "ui:providers" });
      setProviders(next);
      setAccess(await accessOf(next));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Providers.loadFailed"));
    }
  };

  useEffect(() => {
    // Read once per mount on purpose: nothing outside this view changes the
    // provider list, and re-running on every language switch would be noise.
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
      models: modelList(draft.models),
      defaultModel: draft.defaultModel.trim() || undefined,
      apiKey: draft.apiKey.trim() || undefined,
    };

    setSaving(true);
    try {
      // Save before asking for anything. Granting host access needs a window of
      // its own — the prompt would otherwise take focus and destroy the popup
      // mid-save — so the provider has to exist on its own by then.
      const saved = await send<ProviderView[]>({ type: "ui:saveProvider", input });
      setProviders(saved);
      setAccess(await accessOf(saved));
      setDraft(null);
      setRemote(null);
      setNotice(t("Providers.saved"));

      const origin = providerOrigin(input.baseUrl);
      if (origin && !(await hasAccess(origin))) openGrantWindow(origin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Providers.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string): Promise<void> => {
    try {
      setProviders(await send<ProviderView[]>({ type: "ui:deleteProvider", id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Providers.deleteFailed"));
    }
  };

  const makeDefault = async (id: string): Promise<void> => {
    try {
      setProviders(await send<ProviderView[]>({ type: "ui:setDefaultProvider", id }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Providers.defaultFailed"));
    }
  };

  /** Turns a failed probe into one localized line, plus a Grant button if that is the fix. */
  const report = (result: ProbeError, baseUrl: string): void => {
    setError(probeMessage(result, t, hostOf(baseUrl)));
    if (result.reason === "no-access") setNeedGrant(providerOrigin(baseUrl));
  };

  const startProbe = (kind: "test" | "models", target: string): void => {
    setError(null);
    setNotice(null);
    setNeedGrant(null);
    setBusy({ kind, target });
  };

  const testConnection = async (target: string, input: ProbeDraft): Promise<void> => {
    startProbe("test", target);
    try {
      const result = await send<TestResult>({ type: "ui:testProvider", input });
      if (result.ok) {
        setNotice(t("Providers.testOk", { model: result.model, ms: result.latencyMs }));
      } else {
        report(result, input.baseUrl);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Providers.testFailed"));
    } finally {
      setBusy(null);
    }
  };

  /** Row-level "Fetch models": opens the editor with the catalogue already in it. */
  const pullModels = async (provider: ProviderView): Promise<void> => {
    setError(null);
    setNotice(null);
    setNeedGrant(null);
    setRemote(null);
    setDraft({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      models: provider.models.join(", "),
      defaultModel: provider.defaultModel ?? "",
      apiKey: "",
    });
    await fetchModels(provider.id, { id: provider.id, baseUrl: provider.baseUrl });
  };

  const fetchModels = async (target: string, input: ProbeDraft): Promise<void> => {
    startProbe("models", target);
    try {
      const result = await send<RemoteModels>({ type: "ui:listModels", input });
      if (!result.ok) {
        setRemote(null);
        report(result, input.baseUrl);
        return;
      }
      setRemote(result);
      setNotice(
        result.models.length
          ? t("Providers.fetched", {
              host: result.host,
              count: result.models.length,
              ms: result.latencyMs,
            })
          : t("Providers.fetchEmpty", { host: result.host }),
      );

      // A fetched list with nothing selected yet is a form the user has to fill
      // in by hand; taking the whole list is what they are going to do anyway.
      setDraft((current) => {
        if (!current || modelList(current.models).length > 0 || result.models.length === 0) {
          return current;
        }
        return {
          ...current,
          models: result.models.join(", "),
          defaultModel: current.defaultModel.trim() || (result.models[0] ?? ""),
        };
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("Providers.fetchFailed", { host: hostOf(input.baseUrl) }),
      );
    } finally {
      setBusy(null);
    }
  };

  const remoteModels = remote?.ok ? remote.models : [];

  return (
    <>
      <Card title={t("Providers.title")} description={t("Providers.description")}>
        {providers.length === 0 ? (
          <p className="empty">{t("Providers.empty")}</p>
        ) : (
          providers.map((provider) => (
            <div className="item" key={provider.id}>
              <div>
                <div className="item-title">
                  {provider.name}{" "}
                  {provider.isDefault ? (
                    <span className="badge badge-ok">{t("Common.default")}</span>
                  ) : null}{" "}
                  {access[provider.id] === false ? (
                    <span className="badge badge-warn">{t("Common.noAccess")}</span>
                  ) : null}
                </div>
                <div className="mono">{provider.baseUrl}</div>
                <div className="muted">
                  {provider.models.join(" · ") || t("Providers.noModels")} ·{" "}
                  {t("Providers.savedAt", { when: timeAgo(provider.updatedAt) })}
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
                    {t("Common.grantAccess")}
                  </button>
                ) : null}
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() =>
                    void testConnection(provider.id, {
                      id: provider.id,
                      baseUrl: provider.baseUrl,
                      model: provider.defaultModel,
                    })
                  }
                >
                  {busy?.kind === "test" && busy.target === provider.id
                    ? t("Providers.testing")
                    : t("Providers.test")}
                </button>
                <button
                  className="btn"
                  disabled={busy !== null}
                  onClick={() => void pullModels(provider)}
                >
                  {busy?.kind === "models" && busy.target === provider.id
                    ? t("Providers.fetching")
                    : t("Providers.fetch")}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setRemote(null);
                    setError(null);
                    setNotice(null);
                    setDraft({
                      id: provider.id,
                      name: provider.name,
                      baseUrl: provider.baseUrl,
                      models: provider.models.join(", "),
                      defaultModel: provider.defaultModel ?? "",
                      apiKey: "",
                    });
                  }}
                >
                  {t("Common.edit")}
                </button>
                {provider.isDefault ? null : (
                  <button className="btn" onClick={() => void makeDefault(provider.id)}>
                    {t("Providers.makeDefault")}
                  </button>
                )}
                <button className="btn btn-danger" onClick={() => void remove(provider.id)}>
                  {t("Common.remove")}
                </button>
              </div>
            </div>
          ))
        )}
      </Card>

      {notice ? <p className="badge badge-ok">{notice}</p> : null}
      <ErrorText error={error} />
      {needGrant ? (
        <button className="btn" onClick={() => openGrantWindow(needGrant)}>
          {t("Common.grantAccess")}
        </button>
      ) : null}

      {draft ? (
        <Card title={draft.id ? t("Providers.editTitle") : t("Providers.addTitle")}>
          <form className="stack" onSubmit={save}>
            {draft.id ? null : (
              <Field label={t("Providers.preset")}>
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

            <Field label={t("Providers.name")}>
              <input
                className="input"
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>

            <Field label={t("Providers.baseUrl")} hint={t("Providers.baseUrlHint")}>
              <input
                className="input"
                value={draft.baseUrl}
                onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              />
            </Field>

            <Field label={t("Providers.models")} hint={t("Providers.modelsHint")}>
              <div className="stack">
                <input
                  className="input"
                  value={draft.models}
                  onChange={(event) => setDraft({ ...draft, models: event.target.value })}
                />
                <div className="actions">
                  <button
                    className="btn"
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void fetchModels("draft", {
                        id: draft.id,
                        baseUrl: draft.baseUrl,
                        apiKey: draft.apiKey.trim() || undefined,
                      })
                    }
                  >
                    {busy?.kind === "models" && busy.target === "draft"
                      ? t("Providers.fetching")
                      : t("Providers.fetch")}
                  </button>
                  {remoteModels.length > 0 ? (
                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          models: mergeModels(draft.models, remoteModels),
                          defaultModel: draft.defaultModel.trim() || (remoteModels[0] ?? ""),
                        })
                      }
                    >
                      {t("Providers.addAll")}
                    </button>
                  ) : null}
                </div>
                {remoteModels.length > 0 ? (
                  // Chips instead of a dump: the fetched list is usually wider
                  // than what the user wants in the pool, and a click per model
                  // is clearer than editing a comma-separated line by hand.
                  <div className="chips">
                    {remoteModels.map((model) => {
                      const picked = modelList(draft.models).includes(model);
                      return (
                        <button
                          key={model}
                          type="button"
                          className={picked ? "chip chip-on" : "chip"}
                          aria-pressed={picked}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              models: picked
                                ? modelList(draft.models).filter((id) => id !== model).join(", ")
                                : mergeModels(draft.models, [model]),
                            })
                          }
                        >
                          {model}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </Field>

            <Field label={t("Providers.defaultModel")}>
              <input
                className="input"
                list="fluid-model-options"
                value={draft.defaultModel}
                onChange={(event) => setDraft({ ...draft, defaultModel: event.target.value })}
              />
              <datalist id="fluid-model-options">
                {(remoteModels.length ? remoteModels : modelList(draft.models)).map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>
            </Field>

            <Field
              label={t("Providers.apiKey")}
              hint={draft.id ? t("Providers.apiKeyKeep") : t("Providers.apiKeyNew")}
            >
              <input
                className="input"
                type="password"
                value={draft.apiKey}
                onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              />
            </Field>

            <div className="actions">
              <button className="btn btn-primary" type="submit" disabled={saving}>
                {saving ? t("Providers.saving") : t("Providers.save")}
              </button>
              <button
                className="btn"
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  void testConnection("draft", {
                    id: draft.id,
                    baseUrl: draft.baseUrl,
                    apiKey: draft.apiKey.trim() || undefined,
                    model: draft.defaultModel.trim() || modelList(draft.models)[0],
                  })
                }
              >
                {busy?.kind === "test" && busy.target === "draft"
                  ? t("Providers.testing")
                  : t("Providers.test")}
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setDraft(null);
                  setRemote(null);
                  setNeedGrant(null);
                }}
              >
                {t("Common.cancel")}
              </button>
            </div>
            <p className="hint">{t("Providers.grantHint")}</p>
          </form>
        </Card>
      ) : (
        <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY })}>
          {t("Providers.add")}
        </button>
      )}
    </>
  );
}

/** `deepseek-chat, deepseek-reasoner` → `["deepseek-chat", "deepseek-reasoner"]`. */
function modelList(value: string): string[] {
  return value
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);
}

/** Adds a fetched list to the current one without duplicating or reordering it. */
function mergeModels(current: string, incoming: string[]): string {
  return [...new Set([...modelList(current), ...incoming])].join(", ");
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
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

/**
 * One localized line per failure.
 *
 * The service worker answers with a reason code rather than a message, so the
 * wording lives here, next to the user, and switching language switches it too.
 */
function probeMessage(result: ProbeError, t: TFunction, host: string): string {
  switch (result.reason) {
    case "no-key":
      return t("Providers.fetchNeedsKey");
    case "no-access":
      return t("Providers.fetchNeedsAccess", { host });
    case "invalid-url":
      return t("Providers.reasonInvalidUrl");
    case "unauthorized":
      return t("Providers.reasonUnauthorized");
    case "not-found":
      return t("Providers.reasonNotFound");
    case "timeout":
      return t("Providers.reasonTimeout");
    case "network":
      return t("Providers.reasonNetwork");
    case "no-model":
      return t("Providers.reasonNoModel");
    case "http":
      return t("Providers.reasonHttp", { status: result.status ?? 0 });
  }
}
