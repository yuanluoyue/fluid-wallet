import { PROTOCOL_VERSION } from "@fluid-wallet/protocol";
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";

import { send } from "../../src/ui-client";
import type { ConnectionView, ProviderView, UiState } from "../../src/wallet/ui";

/**
 * The popup is a status surface, not a control panel: it answers "can apps use
 * my models right now?" and hands off to the options page for everything else.
 */
export function App() {
  const [state, setState] = useState<UiState | null>(null);
  const [providerCount, setProviderCount] = useState<number | null>(null);
  const [connectionCount, setConnectionCount] = useState<number | null>(null);

  useEffect(() => {
    void send<UiState>({ type: "ui:state" }).then(async (next) => {
      setState(next);
      if (next.locked) return;
      const [providers, connections] = await Promise.all([
        send<ProviderView[]>({ type: "ui:providers" }),
        send<ConnectionView[]>({ type: "ui:connections" }),
      ]);
      setProviderCount(providers.length);
      setConnectionCount(connections.length);
    });
  }, []);

  const open = (): void => {
    void browser.runtime.openOptionsPage();
  };

  return (
    <main
      style={{
        width: 320,
        padding: 16,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        color: "#14181f",
        background: "#f8fafc",
      }}
    >
      <header style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{ width: 8, height: 8, borderRadius: 999, background: "#4f46e5" }}
          aria-hidden
        />
        <strong style={{ fontSize: 15 }}>Fluid Wallet</strong>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#6b7480" }}>
          v{PROTOCOL_VERSION}
        </span>
      </header>

      <p style={{ margin: "12px 0 0", fontSize: 13 }}>
        {state === null
          ? "Loading…"
          : !state.configured
            ? "No wallet yet — set a master password to start."
            : state.locked
              ? "Locked. Unlock to let apps call your models."
              : "Ready. Connected apps can call your models."}
      </p>

      {providerCount !== null ? (
        <p style={{ margin: "6px 0 0", fontSize: 12, color: "#6b7480" }}>
          {providerCount} provider{providerCount === 1 ? "" : "s"} · {connectionCount ?? 0} connected
          app{(connectionCount ?? 0) === 1 ? "" : "s"}
        </p>
      ) : null}

      <button
        onClick={open}
        style={{
          marginTop: 14,
          width: "100%",
          padding: "9px 12px",
          borderRadius: 8,
          border: "1px solid #4f46e5",
          background: "#4f46e5",
          color: "#fff",
          font: "inherit",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {state?.locked || state?.configured === false ? "Unlock wallet" : "Open wallet"}
      </button>

      <p style={{ margin: "10px 0 0", fontSize: 11, color: "#6b7480" }}>
        Every request stays inside your browser. No account, no telemetry.
      </p>
    </main>
  );
}
