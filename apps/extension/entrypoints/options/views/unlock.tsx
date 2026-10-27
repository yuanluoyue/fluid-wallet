import { useState, type FormEvent } from "react";

import type { UiState } from "../../../src/wallet/ui";
import { ErrorText, Field, send } from "../components";

export function Onboarding({ onDone }: { onDone: (state: UiState) => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      onDone(await send<UiState>({ type: "ui:setup", password }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the wallet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <h1 className="hero-title">Create your wallet</h1>
      <p className="muted">
        Your API keys are encrypted on this device with a key derived from this password. It never
        leaves the browser and is never sent anywhere.
      </p>

      <form className="card stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <Field label="Master password" hint="At least 8 characters.">
          <input
            className="input"
            type="password"
            value={password}
            autoFocus
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm password">
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        <button className="btn btn-primary" type="submit" disabled={busy || password.length < 8}>
          {busy ? "Creating…" : "Create wallet"}
        </button>
        <p className="hint">
          There is no recovery: forgetting this password means re-entering your API keys, not losing
          your accounts.
        </p>
      </form>
    </main>
  );
}

export function Unlock({ onUnlocked }: { onUnlocked: (state: UiState) => void }) {
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
      setError(cause instanceof Error ? cause.message : "Could not unlock the wallet.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <div className="brand" style={{ marginBottom: 18 }}>
        <span className="dot" aria-hidden />
        Fluid Wallet
      </div>
      <h1 className="hero-title">Locked</h1>
      <p className="muted">Enter your master password to unlock model access for connected apps.</p>

      <form className="card stack" style={{ marginTop: 20 }} onSubmit={submit}>
        <Field label="Master password">
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
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
