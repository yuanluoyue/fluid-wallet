import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "../../i18n/react";
import type { UiState } from "../../wallet/ui";
import { ErrorText, Field, Screen, send } from "../components";
import { LanguageSelect } from "../language";

/**
 * Both pre-wallet screens (first run and unlock) are reachable before the user
 * can pick a language anywhere else, so each carries the picker in the corner.
 */
function MinimalHeader() {
  return (
    <div className="flex items-center justify-end">
      <LanguageSelect compact />
    </div>
  );
}

/** Shared shape of the two screens so they cannot drift apart visually. */
function AuthForm({
  children,
  onSubmit,
}: {
  children: ReactNode;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4"
    >
      {children}
    </form>
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
    <Screen>
      <MinimalHeader />
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{t("Onboarding.title")}</h1>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          {t("Onboarding.body")}
        </p>
      </div>

      <AuthForm onSubmit={submit}>
        <Field
          label={t("Onboarding.password")}
          hint={t("Onboarding.passwordHint")}
          htmlFor="setup-password"
        >
          <Input
            id="setup-password"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label={t("Onboarding.confirm")} htmlFor="setup-confirm">
          <Input
            id="setup-confirm"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || password.length < 8}>
          {busy ? t("Onboarding.submitting") : t("Onboarding.submit")}
        </Button>
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          {t("Onboarding.noRecovery")}
        </p>
      </AuthForm>
    </Screen>
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
    <Screen>
      <MinimalHeader />
      <div className="flex flex-col gap-1.5">
        <div className="mb-1 flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
          <span className="size-2.5 rounded-full bg-primary ring-4 ring-primary/10" aria-hidden />
          Fluid Wallet
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t("Unlock.title")}</h1>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("Unlock.body")}</p>
      </div>

      <AuthForm onSubmit={submit}>
        <Field label={t("Unlock.password")} htmlFor="unlock-password">
          <Input
            id="unlock-password"
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy || password.length === 0}>
          {busy ? t("Unlock.submitting") : t("Unlock.submit")}
        </Button>
      </AuthForm>
    </Screen>
  );
}
