import type { ReactNode } from "react";

import { send } from "../ui-client";

export { send };

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return <p className="error">{error}</p>;
}

export function Card({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {children ? <div className="stack" style={{ marginTop: 14 }}>{children}</div> : null}
    </section>
  );
}

export function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const CAPABILITY_LABELS: Record<string, string> = {
  "wallet:read": "Read wallet status",
  "models:list": "See available models",
  "inference:text": "Send prompts to your models",
  "inference:stream": "Stream responses",
  "inference:tools": "Call tools it defines",
  "inference:proxy": "Use the provider's own API directly",
  "conversation:read": "Read its own conversation history",
  "conversation:write": "Save conversation history",
  "activity:read": "Read its own usage log",
};

export function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}
