import { useCallback, useEffect, useState } from "react";

import type { UiState } from "../wallet/ui";
import { send } from "./components";
import { ActivityView } from "./views/activity";
import { ApprovalView } from "./views/approval";
import { ConnectionsView } from "./views/connections";
import { GrantView } from "./views/grant";
import { ImportView } from "./views/import";
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

/**
 * The whole wallet UI, mounted twice: inside the toolbar popup, and on the
 * options page (used for the first-run tab and the approval window).
 *
 * Both surfaces share one tree on purpose — a second, popup-sized implementation
 * would drift from the full one the moment a setting is added. Only the layout
 * responds to the surface, through `body[data-surface="popup"]` in style.css.
 */
export function App() {
  const [state, setState] = useState<UiState | null>(null);
  const [tab, setTab] = useState<TabId>("providers");
  const [error, setError] = useState<string | null>(null);

  const search = new URLSearchParams(window.location.search);
  const approvalId = search.get("approve");
  const view = search.get("view");

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

  // A window the popup opened for something it cannot host: the permission
  // prompt, or a file picker. Each renders on its own, without the wallet shell.
  if (view === "grant") return <GrantView origin={search.get("origin") ?? ""} />;
  if (view === "import") return <ImportView />;

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

      <div className="panel">
        {tab === "providers" ? <ProvidersView /> : null}
        {tab === "connections" ? <ConnectionsView /> : null}
        {tab === "activity" ? <ActivityView /> : null}
        {tab === "settings" ? <SettingsView state={state} onState={setState} /> : null}
      </div>
    </main>
  );
}
