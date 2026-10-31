import { en, type Messages } from "./messages/en";
import { zh } from "./messages/zh";

/**
 * Two things this module deliberately does not do.
 *
 * No `next-intl`: the wallet is a Vite extension, not a Next app, and the whole
 * of next-intl's value here — routing, request scoping, server/client message
 * splitting — is dead weight in a popup that renders one page. What is worth
 * carrying over from mossgap is the *shape*: namespaced messages, a dotted key,
 * and one small formatter instead of a runtime with a locale file loader.
 *
 * No runtime fallback for a missing key: `zh.ts` is typed as `Messages`, so a
 * key that exists here and not there does not compile. A missing translation is
 * a build error, not an English string inside a Chinese panel.
 */

export const LOCALES = ["en", "zh"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Shown in the language picker. Always each language's own name. */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
};

const registry: Record<Locale, Messages> = { en, zh };

/** Dotted paths to every leaf string, e.g. `"Providers.testOk"`. */
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

export type MessageKey = LeafPaths<Messages>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** Stored or default: anything unrecognised becomes the default. */
export function resolveLocale(value: string | null | undefined): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The browser's preference, narrowed to a language we have.
 *
 * `zh-CN`, `zh-Hant-TW` and `zh` all mean Chinese here: region does not change
 * a single string in this UI, and splitting the file per region would be three
 * copies of the same 200 lines.
 */
export function detectLocale(language: string | undefined): Locale {
  if (!language) return DEFAULT_LOCALE;
  return language.toLowerCase().startsWith("zh") ? "zh" : DEFAULT_LOCALE;
}

/** Walks a dotted key through the message tree. Returns undefined, never throws. */
function lookup(locale: Locale, key: string): string | undefined {
  let node: unknown = registry[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/**
 * Translate one key.
 *
 * A key that does not resolve is returned as-is rather than throwing: this runs
 * inside render, and a typo should not blank the wallet. The type system is
 * what keeps that from happening in the first place; the fallback only covers
 * dynamic keys such as capability names, where the value came from the wire.
 */
export function translate(
  locale: Locale,
  key: MessageKey | (string & {}),
  values?: Record<string, string | number>,
): string {
  const template = lookup(locale, key) ?? lookup(DEFAULT_LOCALE, key) ?? key;
  return values ? formatMessage(template, values) : template;
}

/**
 * Minimal ICU: `{name}` interpolation and `{name, plural, …}`.
 *
 * Ported from mossgap's `src/i18n/messages.ts` for the same reason it exists
 * there — that project needed interpolation without paying for `intl-messageformat`
 * on every render — and trimmed to the branch syntax these messages actually
 * use. Plural runs first, because its body contains braces that the simple
 * substitution would otherwise eat. An unmatched template is returned intact.
 */
export function formatMessage(template: string, values: Record<string, string | number>): string {
  return formatPlural(template, values).replace(/\{(\w+)\}/g, (full, key: string) =>
    key in values ? String(values[key]) : full,
  );
}

function formatPlural(template: string, values: Record<string, string | number>): string {
  return template.replace(
    /\{(\w+),\s*plural,\s*([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g,
    (full, name: string, body: string) => {
      const value = values[name];
      if (typeof value !== "number") return full;

      const branches: Array<{ key: string; text: string }> = [];
      const branchRe = /(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g;
      let match: RegExpExecArray | null;
      while ((match = branchRe.exec(body)) !== null) {
        branches.push({ key: match[1] ?? "", text: match[2] ?? "" });
      }
      if (branches.length === 0) return full;

      // Only the English rule is implemented: 1 is `one`, everything else is
      // `other`. Every message here is en or zh, and zh has no plural forms.
      const hit =
        branches.find((branch) => branch.key === `=${value}`) ??
        branches.find((branch) => branch.key === (value === 1 ? "one" : "other")) ??
        branches.find((branch) => branch.key === "other");
      if (!hit) return full;

      return hit.text.replace(/#/g, String(value));
    },
  );
}

export type { Messages };
