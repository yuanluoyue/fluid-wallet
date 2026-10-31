import { browser } from "wxt/browser";

import { detectLocale, isLocale, type Locale } from ".";

/**
 * The chosen language lives in `storage.local`, not in the wallet database.
 *
 * Two reasons. It has to be readable before the vault exists — the onboarding
 * screen is the first thing a user sees, and it should already be in their
 * language. And it has to be the same value in the popup, the options tab and
 * the approval window, which are separate documents that may be open at once.
 */
const LOCALE_KEY = "fluid.locale";

export async function readLocale(): Promise<Locale> {
  try {
    const stored = (await browser.storage.local.get(LOCALE_KEY))[LOCALE_KEY];
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable in a torn-down context; the browser's own
    // preference is a fine answer there.
  }
  return detectLocale(globalThis.navigator?.language);
}

export async function writeLocale(locale: Locale): Promise<void> {
  await browser.storage.local.set({ [LOCALE_KEY]: locale });
}

/**
 * Follows the choice made in another window.
 *
 * Without this, switching the language on the options tab would leave a popup
 * that was already open in the old one until it is reopened — the popup dies on
 * blur, so this mostly matters for the approval window sitting beside it.
 */
export function watchLocale(onChange: (locale: Locale) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== "local") return;
    const next = changes[LOCALE_KEY]?.newValue;
    if (isLocale(next)) onChange(next);
  };

  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}
