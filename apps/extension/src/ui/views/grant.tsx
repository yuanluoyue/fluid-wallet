import { useState } from "react";
import { browser } from "wxt/browser";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "../../i18n/react";
import { Screen } from "../components";

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
      <Screen>
        <h1 className="text-xl font-semibold tracking-tight">{t("Grant.unknownTitle")}</h1>
        <p className="text-[12.5px] text-muted-foreground">{t("Grant.unknownBody")}</p>
        <Button variant="outline" className="self-start" onClick={() => window.close()}>
          {t("Common.close")}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex flex-col gap-1.5">
        <Badge className="mb-1 self-start">{t("Grant.badge")}</Badge>
        <h1 className="text-xl font-semibold tracking-tight">{t("Grant.title")}</h1>
        <p className="font-mono text-[11.5px] text-muted-foreground">{origin}</p>
      </div>

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("Grant.body")}</p>

      {status === "granted" ? (
        <Badge variant="success" className="self-start">
          {t("Grant.granted")}
        </Badge>
      ) : null}
      {status === "denied" ? (
        <Badge variant="warning" className="self-start">
          {t("Grant.denied")}
        </Badge>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button
          onClick={() => void allow()}
          disabled={status === "asking" || status === "granted"}
        >
          {status === "granted"
            ? t("Grant.grantedButton")
            : status === "asking"
              ? t("Grant.waiting")
              : t("Grant.allow")}
        </Button>
        <Button variant="ghost" onClick={() => window.close()}>
          {t("Common.close")}
        </Button>
      </div>
    </Screen>
  );
}
