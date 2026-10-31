import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n/react";
import type { UiState } from "../wallet/ui";
import { send } from "./components";
import { LanguageSelect } from "./language";
import { ActivityView } from "./views/activity";
import { ApprovalView } from "./views/approval";
import { ConnectionsView } from "./views/connections";
import { GrantView } from "./views/grant";
import { ImportView } from "./views/import";
import { ProvidersView } from "./views/providers";
import { SettingsView } from "./views/settings";
import { SetupView } from "./views/setup";
import { Onboarding, Unlock } from "./views/unlock";

export type Surface = "popup" | "page";

const TABS = [
  { id: "providers", label: "App.tabs.providers" },
  { id: "connections", label: "App.tabs.connections" },
  { id: "activity", label: "App.tabs.activity" },
  { id: "settings", label: "App.tabs.settings" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * The whole wallet UI, mounted twice: inside the toolbar popup, and on the
 * options page (used for the first-run tab and the approval window).
 *
 * Both surfaces share one tree on purpose — a second, popup-sized implementation
 * would drift from the full one the moment a setting is added. Only the frame
 * responds to `surface`: the panel is a fixed 400×580 box with one scroll area,
 * the page is a centred column that grows.
 */
export function App({ surface }: { surface: Surface }) {
  const { t } = useI18n();

  const search = new URLSearchParams(window.location.search);
  const approvalId = search.get("approve");
  const view = search.get("view");

  // A window can ask for a tab by name — the "no provider yet" window sends the
  // user straight to the list they have to fill in. An unknown value is not a
  // tab, so it falls back instead of rendering an empty panel.
  const requestedTab = TABS.find((item) => item.id === search.get("tab"))?.id ?? "providers";

  const [state, setState] = useState<UiState | null>(null);
  const [tab, setTab] = useState<TabId>(requestedTab);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await send<UiState>({ type: "ui:state" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("App.loadFailed"));
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A window the popup opened for something it cannot host: the permission
  // prompt, or a file picker. Each renders on its own, without the wallet shell.
  if (view === "grant") return <GrantView origin={search.get("origin") ?? ""} />;
  if (view === "import") return <ImportView />;
  // Opened by the service worker when a site tried to connect to a wallet that
  // has no provider yet.
  if (view === "setup") return <SetupView origin={search.get("origin") ?? ""} />;

  if (approvalId) return <ApprovalView requestId={approvalId} />;

  if (!state) {
    return (
      <main className="mx-auto max-w-[460px] px-5 py-10">
        <p className="text-[13px] text-muted-foreground">{error ?? t("App.loading")}</p>
      </main>
    );
  }

  if (!state.configured) {
    return <Onboarding onDone={setState} />;
  }

  if (state.locked) {
    return <Unlock onUnlocked={setState} />;
  }

  return (
    <main
      className={cn(
        "mx-auto flex w-full flex-col",
        surface === "popup" ? "h-[580px] p-3" : "max-w-[780px] px-5 py-7",
      )}
    >
      <header className="mb-3 flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-[14px] font-semibold tracking-tight">
          <span className="size-2.5 rounded-full bg-primary ring-4 ring-primary/10" aria-hidden />
          Fluid Wallet
        </div>
        <div className="flex items-center gap-1.5">
          <LanguageSelect compact />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void send<UiState>({ type: "ui:lock" }).then(setState)}
          >
            {t("App.lock")}
          </Button>
        </div>
      </header>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TabId)}
        className="min-h-0 flex-1 gap-3"
      >
        <TabsList className="shrink-0">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {t(item.label)}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* One scroll area, below the fixed header and tabs. The panel is a
            fixed height because a Chrome popup is sized to its content: without
            it the popup would grow with the provider list until it hit the
            600px ceiling and started scrolling the whole frame, header and all. */}
        <div className={cn("min-h-0 flex-1", surface === "popup" && "overflow-y-auto pr-0.5")}>
          <TabsContent value="providers">
            <ProvidersView surface={surface} />
          </TabsContent>
          <TabsContent value="connections">
            <ConnectionsView />
          </TabsContent>
          <TabsContent value="activity">
            <ActivityView />
          </TabsContent>
          <TabsContent value="settings">
            <SettingsView state={state} onState={setState} />
          </TabsContent>
        </div>
      </Tabs>
    </main>
  );
}
