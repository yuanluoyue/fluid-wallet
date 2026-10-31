import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { translate, type Locale, type MessageKey } from ".";
import { watchLocale, writeLocale } from "./storage";

/** `t("Providers.testOk", { model, ms })` — the whole API surface of this module. */
export type TFunction = (
  key: MessageKey | (string & {}),
  values?: Record<string, string | number>,
) => string;

interface I18nValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TFunction;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Holds the language for one document.
 *
 * `initialLocale` is read before the first render (see `ui/mount.tsx`) rather
 * than inside an effect, so a Chinese user never sees the wallet paint in
 * English and then swap.
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  useEffect(() => watchLocale(setLocaleState), []);

  // The document language drives font fallback and hyphenation as much as it
  // drives anything for a screen reader, and the HTML files ship `lang="en"`.
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const setLocale = useCallback((next: Locale): void => {
    setLocaleState(next);
    void writeLocale(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      setLocale,
      t: (key, values) => translate(locale, key, values),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside <I18nProvider>.");
  return value;
}
