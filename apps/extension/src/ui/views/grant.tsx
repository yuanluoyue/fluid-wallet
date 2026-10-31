import { useState } from "react";
import { browser } from "wxt/browser";

import { useI18n } from "../../i18n/react";

/**
 * Asks the browser for access to one provider origin.
 *
 * The permission prompt has to come from a click on a real page: a toolbar
 * popup is destroyed before the answer arrives, which is exactly why the wallet
 * opens this window instead of asking from the popup.
 *
 * The grant lives in the browser, not in the wallet — the provider row reads it
 * back with `permissions.contains`, so nothing has to be reported home here.
 */
export function GrantView({ origin }: { origin: string }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"idle" | "asking" | "granted" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);

  const allow = async (): Promise<void> => {
    setStatus("asking");
    setError(null);
    try {
      const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        setStatus("denied");
        return;
      }
      setStatus("granted");
      setTimeout(() => window.close(), 700);
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : t("Grant.failed"));
    }
  };

  if (!/^https?:\/\/[^/]+$/.test(origin)) {
    return (
      <div className="narrow">
        <h1 className="hero-title">{t("Grant.unknownTitle")}</h1>
        <p className="muted">{t("Grant.unknownBody")}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => window.close()}>
          {t("Common.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <p className="badge">{t("Grant.badge")}</p>
      <h1 className="hero-title" style={{ marginTop: 10 }}>
        {t("Grant.title")}
      </h1>
      <p className="mono">{origin}</p>
      <p className="muted" style={{ marginTop: 10 }}>
        {t("Grant.body")}
      </p>
      {status === "granted" ? <p className="badge badge-ok">{t("Grant.granted")}</p> : null}
      {status === "denied" ? <p className="badge badge-warn">{t("Grant.denied")}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="stack" style={{ marginTop: 18 }}>
        <button
          className="btn btn-primary"
          onClick={() => void allow()}
          disabled={status === "asking" || status === "granted"}
        >
          {status === "granted"
            ? t("Grant.grantedButton")
            : status === "asking"
              ? t("Grant.waiting")
              : t("Grant.allow")}
        </button>
        <button className="btn" onClick={() => window.close()}>
          {t("Common.close")}
        </button>
      </div>
    </div>
  );
}
