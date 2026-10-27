import { useCallback, useEffect, useState } from "react";

import type { UiState } from "../../src/wallet/ui";
import { send } from "./components";
import { ActivityView } from "./views/activity";
import { ApprovalView } from "./views/approval";
import { ConnectionsView } from "./views/connections";
import { ProvidersView } from "./views/providers";
import { SettingsView } from "./views/settings";
import { Onboarding, Unlock } from "./views/unlock";

const TABS = [
  { id: "providers", label: "Providers" },
  { id: "connections", label: "Connections" },
  { id: "activity", label: "Activity" },
  { id: "settings", label: "Settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [state, setState] = useState<UiState | null>(null);
  const [tab, setTab] = useState<TabId>("providers");
  const [error, setError] = useState<string | null>(null);

  const search = new URLSearchParams(window.location.search);
  const approvalId = search.get("approve");

  const refresh = useCallback(async () => {
    try {
      setState(await send<UiState>({ type: "ui:state" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the wallet state.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (approvalId) return <ApprovalView requestId={approvalId} />;

  if (!state) {
    return (
      <div className="narrow">
        <p className="muted">{error ?? "Loading wallet…"}</p>
      </div>
    );
  }

  if (!state.configured) {
    return <Onboarding onDone={setState} />;
  }

  if (state.locked) {
    return <Unlock onUnlocked={setState} />;
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="dot" aria-hidden />
          Fluid Wallet
        </div>
        <button
          className="btn"
          onClick={() => void send<UiState>({ type: "ui:lock" }).then(setState)}
        >
          Lock
        </button>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            className="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "providers" ? <ProvidersView /> : null}
      {tab === "connections" ? <ConnectionsView /> : null}
      {tab === "activity" ? <ActivityView /> : null}
      {tab === "settings" ? <SettingsView state={state} onState={setState} /> : null}
    </main>
  );
}
