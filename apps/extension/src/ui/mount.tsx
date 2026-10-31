import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { readLocale } from "../i18n/storage";
import { I18nProvider } from "../i18n/react";
import { App, type Surface } from "./app";
import "../styles.css";

/**
 * Mounts the wallet on either surface.
 *
 * The locale is awaited before the first render. Doing it in an effect would
 * paint the default language first and swap a frame later, which is exactly the
 * flash of wrong language that makes an app feel translated rather than
 * localized — and the read is a single `storage.local.get`, so there is nothing
 * to wait for.
 *
 * `surface` is passed down rather than read from a global: the toolbar panel is
 * a fixed 400×580 frame with one scroll area, the options page grows with its
 * content, and that is a layout decision the shell has to know about anyway.
 */
export async function mountWallet(surface: Surface): Promise<void> {
  document.body.dataset.surface = surface;

  const container = document.getElementById("root");
  if (!container) throw new Error("Missing #root container.");

  const locale = await readLocale();

  createRoot(container).render(
    <StrictMode>
      <I18nProvider initialLocale={locale}>
        {/* One provider for the whole document: a tooltip per row would mean a
            timer per row, and only one can be open at a time anyway. */}
        <TooltipProvider>
          <App surface={surface} />
          <Toaster />
        </TooltipProvider>
      </I18nProvider>
    </StrictMode>,
  );
}
