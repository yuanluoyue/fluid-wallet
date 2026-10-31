import type { FluidQuota } from "@fluid-wallet/protocol";
import {
  FluidClient,
  connectFluid,
  describeFluidError,
  type FluidHandle,
  type FluidIssue,
} from "@fluid-wallet/sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

/** The two providers this demo knows how to talk to. */
const PROVIDER_URL = "https://api.deepseek.com/v1";
const MODEL = "deepseek-chat";

const CAPABILITIES = [
  "wallet:read",
  "models:list",
  "inference:text",
  "inference:stream",
  "activity:read",
  "inference:proxy",
] as const;

const s = {
  page: {
    maxWidth: 880,
    margin: "0 auto",
    padding: "40px 20px 96px",
    fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
    color: "#14161a",
  } as const,
  card: {
    border: "1px solid #e3e0da",
    borderRadius: 12,
    padding: 18,
    marginTop: 16,
    background: "#fff",
  } as const,
  chips: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 } as const,
  chip: {
    fontSize: 12,
    padding: "5px 10px",
    borderRadius: 999,
    background: "#f3f1ec",
    color: "#3d424b",
    fontFamily: "ui-monospace, monospace",
  } as const,
  button: {
    padding: "9px 16px",
    borderRadius: 8,
    border: "1px solid #d8d5cf",
    background: "#fff",
    fontSize: 13,
    cursor: "pointer",
  } as const,
  primary: {
    padding: "9px 18px",
    borderRadius: 8,
    border: "1px solid #14161a",
    background: "#14161a",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
  } as const,
  row: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" } as const,
  muted: { color: "#5f6672", fontSize: 13, lineHeight: 1.6 } as const,
  mono: { fontFamily: "ui-monospace, SFMono-Regular, monospace", fontSize: 12 } as const,
} as const;

type Message = { role: "user" | "assistant"; content: string };

export function App() {
  const client = useMemo(() => new FluidClient({ appName: "Fluid Playground" }), []);

  const [handle, setHandle] = useState<FluidHandle | null>(null);
  const [usage, setUsage] = useState<FluidQuota | null>(null);
  const [issue, setIssue] = useState<FluidIssue | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState<Message[]>([]);
  const [draft, setDraft] = useState("用三句话解释什么是浏览器扩展的钱包。");
  const [advanced, setAdvanced] = useState<string[]>([]);

  useEffect(() => () => client.dispose(), [client]);

  useEffect(() => {
    // Detecting up front lets the page say "no wallet installed" before the
    // person clicks anything, instead of failing on their first message.
    void client.detect().then(() => setConnected(false));
  }, [client]);

  const refreshUsage = useCallback(
    async (target?: FluidClient | null) => {
      const source = target ?? handle?.client;
      if (!source) return;
      try {
        setUsage(await source.usage());
      } catch {
        // A missing counter is not worth an error banner.
      }
    },
    [handle],
  );

  const connect = async () => {
    setIssue(null);
    setBusy(true);
    try {
      // Local fallback so the demo runs before the extension is loaded. Without
      // it, the page simply reports "no wallet found" and stops there.
      const devApiKey = import.meta.env.VITE_FLUID_DEV_API_KEY as string | undefined;

      const next = await connectFluid({
        client,
        appName: "Fluid Playground",
        reason: "Stream chat completions with your own provider key.",
        capabilities: [...CAPABILITIES],
        model: MODEL,
        ...(devApiKey ? { devApiKey } : {}),
      });
      setHandle(next);
      setConnected(true);
      await refreshUsage(next.client);
    } catch (error) {
      setIssue(describeFluidError(error));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await handle?.disconnect().catch(() => undefined);
    setHandle(null);
    setConnected(false);
    setUsage(null);
    setTranscript([]);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || !handle || busy) return;

    setIssue(null);
    setBusy(true);
    setDraft("");
    setTranscript((previous) => [
      ...previous,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);

    const append = (chunk: string): void =>
      setTranscript((previous) => {
        const copy = [...previous];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
        return copy;
      });

    try {
      const response = await handle.createFetch()(`${PROVIDER_URL}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: handle.model ?? MODEL,
          stream: true,
          messages: [...transcript, { role: "user", content: text }].map(({ role, content }) => ({
            role,
            content,
          })),
        }),
      });

      if (!response.ok) {
        // Provider statuses pass through the wallet untouched, so a 401 here is
        // the provider's own answer, not a wallet refusal.
        append(await response.text());
        setIssue({
          kind: "provider",
          action: "fix-provider",
          title: `The provider answered ${response.status}`,
          detail: "Check the API key and the model name in the wallet's provider settings.",
        });
        return;
      }

      await readSse(response, append);
      await refreshUsage();
    } catch (error) {
      setIssue(describeFluidError(error));
      setTranscript((previous) => {
        const copy = [...previous];
        if (copy.at(-1)?.content === "") copy.pop();
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  const rawFetch = async () => {
    if (!handle) return;
    try {
      const response = await handle.createFetch()(`${PROVIDER_URL}/models`, { method: "GET" });
      setAdvanced((previous) => [
        `GET /models → ${response.status} ${response.headers.get("content-type") ?? ""}`,
        ...previous,
      ].slice(0, 6));
    } catch (error) {
      setIssue(describeFluidError(error));
    }
  };

  const mode = handle?.mode;
  const available = client.state.availability;
  const locked = client.state.wallet?.locked ?? false;
  // The page cannot see the extension, only whether a script put a bridge on
  // `window`. That one bit is the difference between "not installed" and
  // "installed but not answering", and it is worth showing instead of asking
  // anyone to open DevTools to retype it.
  const bridgePresent = typeof window !== "undefined" && "fluid" in window;

  return (
    <main style={s.page}>
      <h1 style={{ fontSize: 24, margin: 0, letterSpacing: "-0.01em" }}>Fluid Wallet</h1>
      <p style={{ ...s.muted, marginTop: 6 }}>
        A chat app that has no API key. The wallet holds it, approves the site once, and proxies
        every call.
      </p>

      <div style={s.chips}>
        <span style={{ ...s.chip, background: available === "available" ? "#e7f5ec" : "#f3f1ec" }}>
          wallet: {available === "available" ? (locked ? "locked" : "ready") : available}
        </span>
        <span style={{ ...s.chip, background: connected ? "#e7f5ec" : "#f3f1ec" }}>
          access: {connected ? "granted" : "none"}
        </span>
        <span style={s.chip}>
          today: {usage ? `${usage.used}${usage.limit ? ` / ${usage.limit}` : ""}` : "—"}
        </span>
        <span style={{ ...s.chip, background: bridgePresent ? "#e7f5ec" : "#f3f1ec" }}>
          window.fluid: {bridgePresent ? "present" : "undefined"}
        </span>
        <span style={s.chip}>transport: {client.transportKind}</span>
        {mode ? <span style={s.chip}>mode: {mode}</span> : null}
      </div>

      {available === "unavailable" ? (
        <p style={{ ...s.mono, color: "#8a8f99", marginTop: 10, lineHeight: 1.7 }}>
          origin {window.location.origin} · nothing answered `wallet.getInfo` within 2s.{" "}
          {bridgePresent
            ? "The bridge is here, so the extension loaded and its background worker did not answer — check chrome://extensions for errors, then reload."
            : "No script injected here. Load apps/extension/dist/chrome-mv3 as an unpacked extension, then reload this page; a dev-server build only injects while its server runs."}
        </p>
      ) : null}

      {issue ? (
        <section
          style={{
            ...s.card,
            borderColor: issue.action === "none" ? "#e3e0da" : "#f0d3c8",
            background: issue.action === "none" ? "#fff" : "#fdf6f2",
          }}
        >
          <strong style={{ fontSize: 14 }}>{issue.title}</strong>
          <p style={{ ...s.muted, margin: "6px 0 0" }}>{issue.detail}</p>
          <p style={{ ...s.mono, color: "#8a8f99", margin: "8px 0 0" }}>
            action: {issue.action}
            {issue.code ? ` · code ${issue.code}` : ""}
          </p>
        </section>
      ) : null}

      {!connected ? (
        <section style={s.card}>
          <strong style={{ fontSize: 15 }}>Connect the wallet</strong>
          <p style={{ ...s.muted, marginBottom: 0 }}>
            The approval window opens once. After that this page can stream answers without ever
            seeing the key.
          </p>
          <div style={{ ...s.chips, marginTop: 12 }}>
            {CAPABILITIES.map((capability) => (
              <span key={capability} style={s.chip}>
                {capability}
              </span>
            ))}
          </div>
          <div style={{ ...s.row, marginTop: 16 }}>
            <button style={s.primary} onClick={() => void connect()} disabled={busy} type="button">
              {busy ? "Waiting for the wallet…" : "Connect"}
            </button>
            <button style={s.button} onClick={() => void client.detect()} type="button">
              Detect wallet
            </button>
          </div>
        </section>
      ) : (
        <>
          {mode === "dev" ? (
            <section style={{ ...s.card, background: "#fdf8e9", borderColor: "#efe1b8" }}>
              <strong style={{ fontSize: 13 }}>Development mode</strong>
              <p style={{ ...s.muted, margin: "4px 0 0" }}>
                No extension answered, so requests go straight to the provider with{" "}
                <code>FLUID_DEV_API_KEY</code>. The page holds the key in this mode — which is
                exactly what the wallet exists to avoid.
              </p>
            </section>
          ) : null}

          <section style={s.card}>
            <div style={{ ...s.row, justifyContent: "space-between" }}>
              <strong style={{ fontSize: 15 }}>Chat</strong>
              <div style={s.row}>
                <button style={s.button} onClick={() => void refreshUsage()} type="button">
                  Refresh budget
                </button>
                <button style={s.button} onClick={() => void disconnect()} type="button">
                  Disconnect
                </button>
              </div>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              {transcript.length === 0 ? (
                <p style={{ ...s.muted, margin: 0 }}>No messages yet. Ask something below.</p>
              ) : (
                transcript.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    style={{
                      justifySelf: message.role === "user" ? "end" : "start",
                      maxWidth: "88%",
                      padding: "10px 13px",
                      borderRadius: 10,
                      background: message.role === "user" ? "#14161a" : "#f3f1ec",
                      color: message.role === "user" ? "#fff" : "#14161a",
                      fontSize: 14,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {message.content || (busy ? "…" : "")}
                  </div>
                ))
              )}
            </div>

            <div style={{ ...s.row, marginTop: 16, alignItems: "stretch" }}>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void send();
                }}
                rows={2}
                style={{
                  flex: 1,
                  minWidth: 260,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #d8d5cf",
                  fontSize: 13,
                  fontFamily: "inherit",
                  resize: "vertical",
                }}
              />
              <button style={s.primary} onClick={() => void send()} disabled={busy} type="button">
                {busy ? "Streaming…" : "Send"}
              </button>
            </div>
            <p style={{ ...s.muted, marginTop: 8, marginBottom: 0 }}>
              ⌘/Ctrl + Enter also sends. Model: <code>{handle?.model ?? MODEL}</code>
            </p>
          </section>

          <section style={s.card}>
            <strong style={{ fontSize: 14 }}>Advanced</strong>
            <p style={{ ...s.muted, marginTop: 4 }}>
              The wallet only proxies the chat surface: chat completions, embeddings and the model
              list. Anything else is refused before a request leaves the browser.
            </p>
            <div style={{ ...s.row, marginTop: 12 }}>
              <button style={s.button} onClick={() => void rawFetch()} type="button">
                GET /models through the wallet
              </button>
              <button style={s.button} onClick={() => setAdvanced([])} type="button">
                Clear
              </button>
            </div>
            {advanced.length ? (
              <pre
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: "#14161a",
                  color: "#e7e5df",
                  borderRadius: 8,
                  fontSize: 12,
                  overflowX: "auto",
                }}
              >
                {advanced.join("\n")}
              </pre>
            ) : null}
          </section>
        </>
      )}
    </main>
  );
}

/**
 * Minimal SSE reader: enough for the OpenAI-compatible stream, and intentionally
 * provider-shaped so the demo can be pointed at another endpoint.
 */
async function readSse(response: Response, onDelta: (text: string) => void): Promise<void> {
  const reader = response.body?.getReader();
  if (!reader) {
    onDelta(await response.text());
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") continue;

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const text = parsed.choices?.[0]?.delta?.content;
        if (text) onDelta(text);
      } catch {
        // Keep-alive comments and provider noise are not worth surfacing.
      }
    }
  }
}
