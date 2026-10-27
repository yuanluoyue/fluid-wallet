import { useState, type FormEvent } from "react";

import type { UiState } from "../../../src/wallet/ui";
import { Card, ErrorText, Field, send } from "../components";

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
    </>
  );
}
