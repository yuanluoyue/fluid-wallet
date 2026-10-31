import { useMemo } from "react";
import type { ReactNode } from "react";

import {
  Card as CardShell,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { MessageKey } from "../i18n";
import { useI18n } from "../i18n/react";
import { send } from "../ui-client";

export { send };

/**
 * Label + control + hint, stacked.
 *
 * `htmlFor` is explicit rather than implied by nesting: a `<label>` wrapping a
 * Radix select trigger fires a second click on it, and the menu opens and closes
 * before it can be seen.
 */
export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-[11.5px] leading-snug text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-[12.5px] text-destructive">
      {error}
    </p>
  );
}

export function Card({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <CardShell className={className}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      {children ? <CardContent>{children}</CardContent> : null}
    </CardShell>
  );
}

/**
 * The frame every pre-wallet screen uses: onboarding, unlock, and the three
 * single-purpose windows (grant, import, setup).
 */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto flex w-full max-w-[460px] flex-col gap-4 px-5 py-8", className)}>
      {children}
    </main>
  );
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/**
 * Formatting that needs the current language.
 *
 * A hook rather than plain functions because both halves of it — the relative
 * time and the permission names that arrive as wire values — are translated,
 * and threading `t` through every prop call site would be worse than calling
 * this once per view.
 */
export function useFormatters() {
  const { t, locale } = useI18n();

  return useMemo(() => {
    const date = (timestamp: number): string =>
      new Date(timestamp).toLocaleDateString(locale === "zh" ? "zh-CN" : "en");

    return {
      timeAgo(timestamp: number): string {
        const seconds = Math.round((Date.now() - timestamp) / 1000);
        if (seconds < 45) return t("Time.justNow");
        const minutes = Math.round(seconds / 60);
        if (minutes < 60) return t("Time.minutesAgo", { count: minutes });
        const hours = Math.round(minutes / 60);
        if (hours < 24) return t("Time.hoursAgo", { count: hours });
        return date(timestamp);
      },

      dateTime(timestamp: number): string {
        return new Date(timestamp).toLocaleString(locale === "zh" ? "zh-CN" : "en");
      },

      duration(ms: number | undefined): string {
        if (ms === undefined) return "—";
        return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
      },

      /**
       * Capability names come from the wire, so the key is not statically
       * known. An unknown one shows the raw scope — the wallet should never
       * hide a permission it does not have a label for.
       */
      capability(capability: string): string {
        const key = `Capabilities.${capability}`;
        const label = t(key as MessageKey);
        return label === key ? capability : label;
      },
    };
  }, [t, locale]);
}
