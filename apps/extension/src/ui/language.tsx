import { LanguagesIcon } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LOCALES, LOCALE_LABELS, type Locale } from "../i18n";
import { useI18n } from "../i18n/react";

/**
 * The language picker.
 *
 * A Radix select instead of the native control it used to be. The native one
 * put its arrow wherever the platform decided — flush against the border on
 * macOS — and the padding that fixes the text does nothing for the icon. Here
 * the chevron is part of the trigger, so the gap is a class rather than a
 * property of the OS.
 *
 * It appears in the header of every surface, including unlock: the language has
 * to be changeable before the wallet can be opened.
 */
export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <Select value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      <SelectTrigger
        aria-label={t("Common.language")}
        size={compact ? "sm" : "default"}
        className={compact ? "w-auto gap-1.5 pr-2 pl-2.5 text-[12.5px]" : "w-[160px]"}
      >
        {compact ? <LanguagesIcon className="size-3.5 text-muted-foreground" /> : null}
        {/* The label is passed explicitly rather than letting Radix read it off
            the selected item: the item only exists once the menu has been
            opened, and a picker that starts out blank is exactly the kind of
            detail this rewrite is meant to remove. */}
        <SelectValue>{LOCALE_LABELS[locale]}</SelectValue>
      </SelectTrigger>
      <SelectContent align="end">
        {LOCALES.map((code) => (
          <SelectItem key={code} value={code}>
            {LOCALE_LABELS[code]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
