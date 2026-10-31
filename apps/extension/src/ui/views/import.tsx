import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "../../i18n/react";
import type { ImportResult } from "../../wallet/backup";
import { ErrorText, Field, Screen, send } from "../components";

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
    <Screen>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{t("Import.title")}</h1>
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("Import.body")}</p>
      </div>

      <form
        className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void restore();
        }}
      >
        <Field label={t("Import.file")} htmlFor="backup-file">
          <Input
            id="backup-file"
            type="file"
            accept="application/json,.json"
            className="h-auto py-2 text-[12.5px] file:mr-2"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </Field>
        <Field
          label={t("Import.passphrase")}
          hint={t("Import.passphraseHint")}
          htmlFor="import-passphrase"
        >
          <Input
            id="import-passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
          />
        </Field>
        <ErrorText error={error} />
        {notice ? (
          <p className="rounded-md bg-success/10 px-3 py-2 text-[12px] leading-relaxed text-success">
            {notice}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={!file || passphrase.length < 8 || busy}>
            {busy ? t("Import.submitting") : t("Import.submit")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => window.close()}>
            {t("Common.close")}
          </Button>
        </div>
      </form>
    </Screen>
  );
}
