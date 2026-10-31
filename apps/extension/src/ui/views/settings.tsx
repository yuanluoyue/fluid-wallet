import { useState, type FormEvent } from "react";

import { useI18n } from "../../i18n/react";
import type { ExportResult } from "../../wallet/backup";
import type { UiState } from "../../wallet/ui";
import { Card, ErrorText, Field, send } from "../components";
import { LanguageSelect } from "../language";
import { openImportWindow } from "../windows";

const AUTO_LOCK_VALUES = [
  { value: 5 * 60_000, label: "Settings.autoLock.min5" },
  { value: 15 * 60_000, label: "Settings.autoLock.min15" },
  { value: 60 * 60_000, label: "Settings.autoLock.hour1" },
  { value: 0, label: "Settings.autoLock.never" },
] as const;

export function SettingsView({
  state,
  onState,
}: {
  state: UiState;
  onState: (state: UiState) => void;
}) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);

  const changePassword = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    setNotice(null);
    try {
      onState(await send<UiState>({ type: "ui:changePassword", current, next }));
      setCurrent("");
      setNext("");
      setNotice(t("Settings.password.ok"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Settings.password.failed"));
    }
  };

  const changeAutoLock = async (ms: number): Promise<void> => {
    try {
      onState(await send<UiState>({ type: "ui:setAutoLock", ms }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Settings.autoLock.failed"));
    }
  };

  const changeDailyLimit = async (value: string): Promise<void> => {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit < 0) return;
    try {
      onState(await send<UiState>({ type: "ui:setDailyLimit", limit }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Settings.budget.failed"));
    }
  };

  const download = async (): Promise<void> => {
    setBackupError(null);
    setBackupNotice(null);
    try {
      const result = await send<ExportResult>({ type: "ui:exportBackup", passphrase });
      const url = URL.createObjectURL(new Blob([result.contents], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
      setBackupNotice(
        t("Settings.backup.exported", { count: result.providers, file: result.filename }),
      );
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : t("Settings.backup.exportFailed"));
    }
  };

  return (
    <>
      {/* Also in the header, where it is one click away from every screen. This
          copy is here because Settings is where a user goes looking for it. */}
      <Card title={t("Settings.language.title")} description={t("Settings.language.description")}>
        <Field label={t("Common.language")}>
          <LanguageSelect />
        </Field>
      </Card>

      <Card
        title={t("Settings.autoLock.title")}
        description={t("Settings.autoLock.description")}
      >
        <Field label={t("Settings.autoLock.label")}>
          <select
            className="input"
            value={state.autoLockMs}
            onChange={(event) => void changeAutoLock(Number(event.target.value))}
          >
            {AUTO_LOCK_VALUES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn" onClick={() => void send<UiState>({ type: "ui:lock" }).then(onState)}>
          {t("Settings.autoLock.now")}
        </button>
      </Card>

      <Card title={t("Settings.budget.title")} description={t("Settings.budget.description")}>
        <Field label={t("Settings.budget.label")} hint={t("Settings.budget.hint")}>
          <input
            className="input"
            type="number"
            min={0}
            step={10}
            defaultValue={state.dailyLimit}
            key={state.dailyLimit}
            onBlur={(event) => void changeDailyLimit(event.target.value)}
          />
        </Field>
      </Card>

      <Card title={t("Settings.password.title")} description={t("Settings.password.description")}>
        <form className="stack" onSubmit={changePassword}>
          <Field label={t("Settings.password.current")}>
            <input
              className="input"
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
          <Field label={t("Settings.password.next")} hint={t("Settings.password.nextHint")}>
            <input
              className="input"
              type="password"
              value={next}
              onChange={(event) => setNext(event.target.value)}
            />
          </Field>
          <ErrorText error={error} />
          {notice ? <p className="badge badge-ok">{notice}</p> : null}
          <button className="btn btn-primary" type="submit" disabled={!current || next.length < 8}>
            {t("Settings.password.submit")}
          </button>
        </form>
      </Card>

      <Card title={t("Settings.backup.title")} description={t("Settings.backup.description")}>
        <Field label={t("Settings.backup.passphrase")} hint={t("Settings.backup.passphraseHint")}>
          <input
            className="input"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </Field>
        <ErrorText error={backupError} />
        {backupNotice ? <p className="badge badge-ok">{backupNotice}</p> : null}
        <div className="actions">
          <button className="btn" disabled={passphrase.length < 8} onClick={() => void download()}>
            {t("Settings.backup.export")}
          </button>
          <button className="btn" onClick={openImportWindow}>
            {t("Settings.backup.restore")}
          </button>
        </div>
        <p className="hint">{t("Settings.backup.restoreHint")}</p>
      </Card>
    </>
  );
}
