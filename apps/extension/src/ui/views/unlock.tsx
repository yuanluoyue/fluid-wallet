import { useState, type FormEvent } from "react";

import { useI18n } from "../../i18n/react";
import type { UiState } from "../../wallet/ui";
import { ErrorText, Field, send } from "../components";
import { LanguageSelect } from "../language";

/**
 * Both pre-wallet screens (first run and unlock) are reachable before the user
 * can pick a language anywhere else, so each carries the picker in the corner.
 */
function MinimalHeader() {
  return (
    <div className="topbar topbar-minimal">
      <span />
      <LanguageSelect compact />
    </div>
  );
}

export function Onboarding({ onDone }: { onDone: (state: UiState) => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError(t("Onboarding.mismatch"));
      return;
    }
    setBusy(true);
    try {
      onDone(await send<UiState>({ type: "ui:setup", password }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Onboarding.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <MinimalHeader />
      <h1 className="hero-title">{t("Onboarding.title")}</h1>
      <p className="muted">{t("Onboarding.body")}</p>

      <form className="card stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <Field label={t("Onboarding.password")} hint={t("Onboarding.passwordHint")}>
          <input
            className="input"
            type="password"
            value={password}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label={t("Onboarding.confirm")}>
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <button className="btn btn-primary" type="submit" disabled={busy || password.length < 8}>
          {busy ? t("Onboarding.submitting") : t("Onboarding.submit")}
        </button>
        <p className="hint">{t("Onboarding.noRecovery")}</p>
      </form>
    </main>
  );
}

export function Unlock({ onUnlocked }: { onUnlocked: (state: UiState) => void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      onUnlocked(await send<UiState>({ type: "ui:unlock", password }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Unlock.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <MinimalHeader />
      <div className="brand" style={{ marginBottom: 18 }}>
        <span className="dot" aria-hidden />
        Fluid Wallet
      </div>
      <h1 className="hero-title">{t("Unlock.title")}</h1>
      <p className="muted">{t("Unlock.body")}</p>

      <form className="card stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <Field label={t("Unlock.password")}>
          <input
            className="input"
            type="password"
            value={password}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <button className="btn btn-primary" type="submit" disabled={busy || password.length === 0}>
          {busy ? t("Unlock.submitting") : t("Unlock.submit")}
        </button>
      </form>
    </main>
  );
}
