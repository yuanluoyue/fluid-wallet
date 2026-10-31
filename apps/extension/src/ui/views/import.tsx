import { useState } from "react";

import { useI18n } from "../../i18n/react";
import type { ImportResult } from "../../wallet/backup";
import { ErrorText, Field, send } from "../components";

/**
 * Restoring a backup, in the window the popup opens for it.
 *
 * A file picker takes focus, which destroys the toolbar popup before the change
 * event can fire, so the selection has to happen on this page.
 */
export function ImportView() {
  const { t } = useI18n();
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
        t("Import.done", {
          imported: result.imported,
          updated: result.updated,
          skipped: result.skipped ?? 0,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Import.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <h1 className="hero-title">{t("Import.title")}</h1>
      <p className="muted">{t("Import.body")}</p>

      <form
        className="card stack"
        style={{ marginTop: 18 }}
        onSubmit={(event) => {
          event.preventDefault();
          void restore();
        }}
      >
        <Field label={t("Import.file")}>
          <input
            className="input"
            type="file"
            accept="application/json,.json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field label={t("Import.passphrase")} hint={t("Import.passphraseHint")}>
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
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!file || passphrase.length < 8 || busy}
          >
            {busy ? t("Import.submitting") : t("Import.submit")}
          </button>
          <button className="btn" type="button" onClick={() => window.close()}>
            {t("Common.close")}
          </button>
        </div>
      </form>
    </div>
  );
}
