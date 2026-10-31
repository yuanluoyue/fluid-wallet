import { describe, expect, it } from "vitest";

import { detectLocale, formatMessage, translate, type Locale } from "./index";
import { en } from "./messages/en";
import { zh } from "./messages/zh";

type Tree = Record<string, unknown>;

function leafKeys(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [path] : leafKeys(value as Tree, path);
  });
}

/** Reads a dotted key straight out of a message tree. */
function get(tree: unknown, path: string): string {
  return path.split(".").reduce<unknown>((node, part) => (node as Tree)[part], tree) as string;
}

/** `{host}` in a template, sorted so a reordered translation still matches. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? "").sort();
}

describe("message tables", () => {
  it("keeps both languages on exactly the same keys", () => {
    expect(leafKeys(zh as unknown as Tree).sort()).toEqual(leafKeys(en as unknown as Tree).sort());
  });

  it("has no empty strings", () => {
    const emptyIn = (tree: unknown): string[] =>
      leafKeys(tree as Tree).filter((key) => get(tree, key).trim().length === 0);

    expect(emptyIn(en)).toEqual([]);
    expect(emptyIn(zh)).toEqual([]);
  });

  it("keeps the same interpolation slots after translation", () => {
    for (const key of leafKeys(en as unknown as Tree)) {
      // Plural bodies are formatter syntax, not plain slots; the formatter tests
      // below cover them.
      if (get(en, key).includes("plural,")) continue;
      expect(placeholders(get(zh, key)), key).toEqual(placeholders(get(en, key)));
    }
  });

  it("translates something everywhere", () => {
    // Cheap guard against a whole namespace being copied over in English.
    // `Base URL` is the one term deliberately left alone: everyone calls it
    // that, in both languages, and labelling it 基础地址 helps nobody.
    const untranslated = new Set(["Providers.baseUrl"]);
    const identical = leafKeys(en as unknown as Tree).filter(
      (key) => !untranslated.has(key) && get(en, key) === get(zh, key),
    );
    expect(identical).toEqual([]);
  });
});

describe("formatMessage", () => {
  it("interpolates named slots and leaves unknown ones alone", () => {
    expect(formatMessage("Connected. {model} answered in {ms} ms.", { model: "x", ms: 12 })).toBe(
      "Connected. x answered in 12 ms.",
    );
    expect(formatMessage("{a} and {b}", { a: 1 })).toBe("1 and {b}");
  });

  it("resolves the plural branches English needs and Chinese does not", () => {
    const template = "Fetched {count, plural, =0 {no models} one {# model} other {# models}}.";
    expect(formatMessage(template, { count: 0 })).toBe("Fetched no models.");
    expect(formatMessage(template, { count: 1 })).toBe("Fetched 1 model.");
    expect(formatMessage(template, { count: 7 })).toBe("Fetched 7 models.");
  });

  it("returns a template it cannot parse instead of throwing", () => {
    expect(formatMessage("{count, plural, other {x}}", {})).toBe("{count, plural, other {x}}");
  });
});

describe("translate", () => {
  const locales: Locale[] = ["en", "zh"];

  it("resolves a dotted key in both languages", () => {
    expect(translate("en", "App.tabs.providers")).toBe("Providers");
    expect(translate("zh", "App.tabs.providers")).toBe("服务商");
  });

  it("passes values through the formatter", () => {
    expect(translate("zh", "Providers.testOk", { model: "deepseek-chat", ms: 420 })).toBe(
      "连接成功，deepseek-chat 在 420 ms 内返回。",
    );
  });

  it("returns the key itself when it does not resolve", () => {
    for (const locale of locales) {
      expect(translate(locale, "Providers.doesNotExist")).toBe("Providers.doesNotExist");
    }
  });
});

describe("detectLocale", () => {
  it("follows the browser, with English as the floor", () => {
    expect(detectLocale("zh-CN")).toBe("zh");
    expect(detectLocale("zh-Hant-TW")).toBe("zh");
    expect(detectLocale("en-US")).toBe("en");
    expect(detectLocale("fr-FR")).toBe("en");
    expect(detectLocale(undefined)).toBe("en");
  });
});
