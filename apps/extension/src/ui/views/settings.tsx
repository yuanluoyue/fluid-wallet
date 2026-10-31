import { useState, type FormEvent } from "react";

import type { ExportResult } from "../../wallet/backup";
import type { UiState } from "../../wallet/ui";
import { Card, ErrorText, Field, send } from "../components";
import { openImportWindow } from "../windows";

const AUTO_LOCK_OPTIONS = [
  { value: 5 * 60_000, label: "5 minutes" },
  { value: 15 * 60_000, label: "15 minutes" },
  { value: 60 * 60_000, label: "1 hour" },
  { value: 0, label: "Never (not recommended)" },
];

export function SettingsView({
  state,
  onState,
}: {
  state: UiState;
  onState: (state: UiState) => void;
}) {
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
      setNotice("Password changed. Existing keys stay encrypted with the new one.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the password.");
    }
  };

  const changeAutoLock = async (ms: number): Promise<void> => {
    try {
      onState(await send<UiState>({ type: "ui:setAutoLock", ms }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the auto-lock.");
    }
  };

  const changeDailyLimit = async (value: string): Promise<void> => {
    const limit = Number(value);
    if (!Number.isFinite(limit) || limit < 0) return;
    try {
      onState(await send<UiState>({ type: "ui:setDailyLimit", limit }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the daily limit.");
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
        `${result.providers} credential${result.providers === 1 ? "" : "s"} saved to ${result.filename}. Keep the passphrase separate from the file.`,
      );
    } catch (cause) {
      setBackupError(cause instanceof Error ? cause.message : "Could not write the backup.");
    }
  };

  const restore = (): void => {
    openImportWindow();
  };

  return (
    <>
      <Card title="Auto-lock" description="The wallet locks itself after a period without use.">
        <Field label="Lock after">
          <select
            className="input"
            value={state.autoLockMs}
            onChange={(event) => void changeAutoLock(Number(event.target.value))}
          >
            {AUTO_LOCK_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
        <button className="btn" onClick={() => void send<UiState>({ type: "ui:lock" }).then(onState)}>
          Lock now
        </button>
      </Card>

      <Card
        title="Daily request budget"
        description="Counted per site, per day. Requests over the limit are refused before the provider is called, so a retry loop cannot drain your credit overnight."
      >
        <Field label="Requests per site per day" hint="0 means unlimited. Applies to every connected app.">
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

      <Card
        title="Master password"
        description="Changing it rewraps the encryption key; stored API keys are not re-entered."
      >
        <form className="stack" onSubmit={changePassword}>
          <Field label="Current password">
            <input
              className="input"
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </Field>
          <Field label="New password" hint="At least 8 characters.">
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
            Change password
          </button>
        </form>
      </Card>

      <Card
        title="Encrypted backup"
        description="One file with your provider keys, sealed with its own passphrase. Connected apps, grants and logs stay behind on purpose."
      >
        <Field
          label="Backup passphrase"
          hint="At least 8 characters. Not your master password, and not stored anywhere — losing it loses the backup."
        >
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
          <button
            className="btn"
            disabled={passphrase.length < 8}
            onClick={() => void download()}
          >
            Export backup
          </button>
          <button className="btn" onClick={restore}>
            Restore from a file
          </button>
        </div>
        <p className="hint">
          Restoring merges by provider id and needs the passphrase the file was exported with, so it
          opens in a window of its own: a file picker takes focus and the toolbar panel does not
          survive that.
        </p>
      </Card>
    </>
  );
}
