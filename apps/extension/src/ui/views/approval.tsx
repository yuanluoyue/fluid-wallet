import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card as CardShell, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "../../i18n/react";
import type { PendingApproval } from "../../wallet/approval";
import { Screen, hostOf, send, useFormatters } from "../components";

/**
 * Shown in the toolbar panel, or in the fallback window opened by
 * `wallet.connect`.
 *
 * The decision is applied in the service worker, not here: this page only
 * reports the user's choice and goes away. `onDecided` exists because the two
 * surfaces leave differently — a window closes unconditionally, while a panel
 * may still have a second site's request to show.
 */
export function ApprovalView({
  requestId,
  surface = "page",
  queue = 1,
  initial,
  onDecided,
}: {
  requestId: string;
  surface?: "popup" | "page";
  /** Requests waiting in total, this one included. */
  queue?: number;
  /**
   * The request, when the caller already has it.
   *
   * A panel is opened *for* a request, so it arrives with the state that opened
   * it; asking again would only add a spinner in front of the thing the panel
   * exists to show.
   */
  initial?: PendingApproval;
  onDecided?: () => void | Promise<void>;
}) {
  const { t } = useI18n();
  const { capability } = useFormatters();
  const [request, setRequest] = useState<PendingApproval | null | undefined>(initial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    void send<PendingApproval[]>({ type: "ui:approvals" })
      .then((pending) => setRequest(pending.find((entry) => entry.id === requestId) ?? null))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : t("Approval.loadFailed")),
      );
  }, [requestId, initial]);

  const leave = async (): Promise<void> => {
    if (onDecided) await onDecided();
    else window.close();
  };

  const decide = async (decision: "allow" | "always" | "deny"): Promise<void> => {
    try {
      await send({ type: "ui:decide", id: requestId, decision });
      await leave();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Approval.decideFailed"));
    }
  };

  if (request === undefined) {
    return (
      <Screen>
        <p className="text-[12.5px] text-muted-foreground">{t("Approval.loading")}</p>
      </Screen>
    );
  }

  if (request === null) {
    return (
      <Screen>
        <h1 className="text-xl font-semibold tracking-tight">{t("Approval.expiredTitle")}</h1>
        <p className="text-[12.5px] text-muted-foreground">{t("Approval.expiredBody")}</p>
        <Button variant="outline" className="self-start" onClick={() => void leave()}>
          {t("Common.close")}
        </Button>
      </Screen>
    );
  }

  return (
    <Screen>
      <div className="flex flex-col gap-1.5">
        <Badge className="mb-1 self-start">{t("Approval.badge")}</Badge>
        <h1 className="text-xl font-semibold tracking-tight">
          {request.request.appName ?? hostOf(request.origin)}
        </h1>
        <p className="font-mono text-[11.5px] text-muted-foreground">{request.origin}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          <Badge variant={request.context.firstConnection ? "warning" : "success"}>
            {request.context.firstConnection ? t("Approval.firstTime") : t("Approval.again")}
          </Badge>
          {request.context.nameMismatch ? (
            <Badge variant="destructive">{t("Approval.nameMismatch")}</Badge>
          ) : null}
        </div>
        {request.request.reason ? (
          <p className="text-[12.5px] text-muted-foreground">{request.request.reason}</p>
        ) : null}
      </div>

      <CardShell>
        <CardHeader>
          <CardTitle className="text-[13.5px]">{t("Approval.askingFor")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {request.request.capabilities.map((scope) => (
              <Badge key={scope} variant="primary">
                {capability(scope)}
              </Badge>
            ))}
          </div>
          <p className="text-[11.5px] leading-snug text-muted-foreground">
            {t("Approval.neverSeesKey")}
          </p>
        </CardContent>
      </CardShell>

      {request.context.providerNames.length ? (
        <CardShell>
          <CardHeader>
            <CardTitle className="text-[13.5px]">{t("Approval.willUse")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[12.5px] text-muted-foreground">
              {request.context.providerNames.join(", ")}
              {request.context.defaultModel
                ? ` · ${t("Approval.defaultModel", { model: request.context.defaultModel })}`
                : ""}
            </p>
            <p className="text-[11.5px] leading-snug text-muted-foreground">{t("Approval.billed")}</p>
          </CardContent>
        </CardShell>
      ) : null}

      {request.request.capabilities.includes("inference:proxy") ? (
        <CardShell>
          <CardHeader>
            <CardTitle className="text-[13.5px]">{t("Approval.directAccess")}</CardTitle>
            <CardDescription>{t("Approval.directAccessBody")}</CardDescription>
          </CardHeader>
        </CardShell>
      ) : null}

      {error ? (
        <p role="alert" className="text-[12.5px] text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        <Button onClick={() => void decide("allow")}>{t("Approval.allow7")}</Button>
        <Button variant="outline" onClick={() => void decide("always")}>
          {t("Approval.allowAlways")}
        </Button>
        <Button variant="destructive" onClick={() => void decide("deny")}>
          {t("Approval.deny")}
        </Button>
      </div>

      {queue > 1 ? (
        <p className="text-[11.5px] text-muted-foreground">
          {t("Approval.moreWaiting", { count: queue - 1 })}
        </p>
      ) : null}

      {surface === "popup" ? (
        <p className="text-[11.5px] leading-snug text-muted-foreground">
          {t("Approval.popupHint")}
        </p>
      ) : null}
    </Screen>
  );
}
