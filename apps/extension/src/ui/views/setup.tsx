import { browser } from "wxt/browser";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "../../i18n/react";
import { Screen } from "../components";

/**
 * Explains why a site could not connect: there is no provider to connect to.
 *
 * The window is opened by the service worker, not by a click, so it cannot
 * carry the request that caused it — only the origin, which is the part the
 * user needs to judge. "Add a provider" turns this window into the wallet
 * rather than opening a second one: the fix happens on the provider screen,
 * and the user is already looking at it.
 */
export function SetupView({ origin }: { origin: string }) {
  const { t } = useI18n();

  const openProviders = async (): Promise<void> => {
    // The wallet needs more room than this card did; resizing before navigating
    // means the provider form arrives laid out instead of reflowing after paint.
    try {
      const current = await browser.windows.getCurrent();
      if (current.id !== undefined) {
        await browser.windows.update(current.id, { width: 460, height: 700 });
      }
    } catch {
      // A window that could not be resized still navigates below.
    }
    window.location.replace(browser.runtime.getURL("/options.html?tab=providers"));
  };

  if (!/^https?:\/\/[^/]+$/.test(origin)) {
    return (
      <Screen>
        <h1 className="text-xl font-semibold tracking-tight">{t("Setup.unknownTitle")}</h1>
        <p className="text-[12.5px] text-muted-foreground">{t("Setup.unknownBody")}</p>
        <Button variant="outline" className="self-start" onClick={() => window.close()}>
          {t("Common.close")}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex flex-col gap-1.5">
        <Badge variant="warning" className="mb-1 self-start">
          {t("Setup.badge")}
        </Badge>
        <h1 className="text-xl font-semibold tracking-tight">{t("Setup.title")}</h1>
        <p className="font-mono text-[11.5px] text-muted-foreground">{origin}</p>
      </div>

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t("Setup.body")}</p>

      <div className="flex flex-col gap-2">
        <Button onClick={() => void openProviders()}>{t("Setup.add")}</Button>
        <Button variant="ghost" onClick={() => window.close()}>
          {t("Setup.later")}
        </Button>
      </div>
    </Screen>
  );
}
