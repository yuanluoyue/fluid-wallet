import { useState } from "react";

import type { ImportResult } from "../../wallet/backup";
import { ErrorText, Field, send } from "../components";

/**
 * Restoring a backup, in the window the popup opens for it.
 *
 * A file picker takes focus, which destroys the toolbar popup before the change
 * event can fire, so the selection has to happen on this page.
 */
export function ImportView() {
  const [passphrase, setPassphrase] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const restore = async (): Promise<void> => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const contents = await file.text();
      const result = await send<ImportResult>({ type: "ui:importBackup", passphrase, contents });
      setNotice(
        `Restored: ${result.imported} new, ${result.updated} updated${result.skipped ? `, ${result.skipped} skipped` : ""}. Connected apps are not restored — re-connect them.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the backup.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <h1 className="hero-title">Restore a backup</h1>
      <p className="muted">
        Merges by provider id: providers already in this wallet with the same id are overwritten,
        nothing is deleted.
      </p>

      <form
        className="card stack"
        style={{ marginTop: 18 }}
        onSubmit={(event) => {
          event.preventDefault();
          void restore();
        }}
      >
        <Field label="Backup file">
          <input
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          label="Backup passphrase"
          hint="The passphrase the file was exported with — not your master password."
        >
          <input
            className="input"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        {notice ? <p className="badge badge-ok">{notice}</p> : null}
        <div className="actions">
          <button className="btn btn-primary" type="submit" disabled={!file || passphrase.length < 8 || busy}>
            {busy ? "Restoring…" : "Restore"}
          </button>
          <button className="btn" type="button" onClick={() => window.close()}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}
