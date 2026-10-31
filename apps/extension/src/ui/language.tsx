import { LOCALES, LOCALE_LABELS, type Locale } from "../i18n";
import { useI18n } from "../i18n/react";

/**
 * The language picker.
 *
 * A native `<select>` on purpose: it renders as the platform's own control,
 * stays keyboard-reachable, and costs 20px of header space — which is all the
 * toolbar panel can spare. It is mounted in the header of every surface that
 * has one, including the unlock screen, because the language has to be
 * changeable before the wallet is unlocked.
 */
export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <select
      className={compact ? "lang lang-compact" : "lang"}
      aria-label={t("Common.language")}
      title={t("Common.language")}
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
    >
      {LOCALES.map((code) => (
        <option key={code} value={code}>
          {LOCALE_LABELS[code]}
        </option>
      ))}
    </select>
  );
}
