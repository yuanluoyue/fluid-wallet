import { browser } from "wxt/browser";

import { useI18n } from "../../i18n/react";

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
      <div className="narrow">
        <h1 className="hero-title">{t("Setup.unknownTitle")}</h1>
        <p className="muted">{t("Setup.unknownBody")}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => window.close()}>
          {t("Common.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <p className="badge badge-warn">{t("Setup.badge")}</p>
      <h1 className="hero-title" style={{ marginTop: 10 }}>
        {t("Setup.title")}
      </h1>
      <p className="mono">{origin}</p>
      <p className="muted" style={{ marginTop: 10 }}>
        {t("Setup.body")}
      </p>

      <div className="stack" style={{ marginTop: 18 }}>
        <button className="btn btn-primary" onClick={() => void openProviders()}>
          {t("Setup.add")}
        </button>
        <button className="btn" onClick={() => window.close()}>
          {t("Setup.later")}
        </button>
      </div>
    </div>
  );
}
