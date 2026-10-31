import { useEffect, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "../../i18n/react";
import type { ConnectionView } from "../../wallet/ui";
import { Card, ErrorText, hostOf, send, useFormatters } from "../components";

export function ConnectionsView() {
  const { t } = useI18n();
  const { timeAgo, dateTime, capability } = useFormatters();
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send<ConnectionView[]>({ type: "ui:connections" })
      .then(setConnections)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : t("Connections.loadFailed")),
      );
  }, []);

  const revoke = async (origin: string): Promise<void> => {
    try {
      setConnections(await send<ConnectionView[]>({ type: "ui:revoke", origin }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Connections.revokeFailed"));
    }
  };

  const revokeAll = async (): Promise<void> => {
    try {
      setConnections(await send<ConnectionView[]>({ type: "ui:revokeAll" }));
      setConfirmOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Connections.revokeAllFailed"));
    }
  };

  return (
    <Card title={t("Connections.title")} description={t("Connections.description")}>
      {connections.length > 0 ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" className="self-start">
              {t("Connections.revokeAll", { count: connections.length })}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Connections.revokeAllTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("Connections.revokeAllBody", { count: connections.length })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Connections.keep")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void revokeAll()}
              >
                {t("Connections.revokeAllConfirm", { count: connections.length })}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {connections.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">
          {t("Connections.empty")}
        </p>
      ) : (
        <div className="divide-y divide-border">
          {connections.map((connection) => (
            <div
              key={connection.origin}
              className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[13.5px] font-semibold">{hostOf(connection.origin)}</span>
                <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                  {connection.origin}
                </span>
                <div className="flex flex-wrap gap-1">
                  {connection.capabilities.map((scope) => (
                    <Badge key={scope}>{capability(scope)}</Badge>
                  ))}
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  {t("Connections.granted", { when: timeAgo(connection.grantedAt) })}
                  {connection.expiresAt
                    ? ` · ${t("Connections.expires", { when: dateTime(connection.expiresAt) })}`
                    : ""}
                  {connection.providers.length
                    ? ` · ${connection.providers.join(", ")}`
                    : ` · ${t("Connections.allProviders")}`}
                </p>
                <p className="text-[11.5px] text-muted-foreground">
                  {connection.dailyLimit > 0
                    ? t("Connections.today", {
                        used: connection.requestsToday,
                        limit: connection.dailyLimit,
                      })
                    : t("Connections.todayNoLimit", { used: connection.requestsToday })}
                </p>
              </div>
              <Button
                variant="destructive"
                size="xs"
                className="self-start"
                onClick={() => void revoke(connection.origin)}
              >
                {t("Connections.revoke")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <ErrorText error={error} />
    </Card>
  );
}
