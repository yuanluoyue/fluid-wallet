import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { readLocale } from "../i18n/storage";
import { I18nProvider } from "../i18n/react";
import { App } from "./app";
import "./style.css";

/**
 * Mounts the wallet on either surface.
 *
 * The locale is awaited before the first render. Doing it in an effect would
 * paint the default language first and swap a frame later, which is exactly the
 * flash of wrong language that makes an app feel translated rather than
 * localized — and the read is a single `storage.local.get`, so there is nothing
 * to wait for.
 */
export async function mountWallet(surface: "popup" | "page"): Promise<void> {
  // The flag only switches layout rules in style.css: the panel is a fixed
  // 400x580 frame with one scroll area, the tab keeps the 780px shell.
  document.body.dataset.surface = surface;

  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root container.");

  const locale = await readLocale();

  createRoot(container).render(
    <StrictMode>
      <I18nProvider initialLocale={locale}>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}
