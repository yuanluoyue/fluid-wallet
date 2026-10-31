import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { useI18n } from "../../i18n/react";
import type { ActivityView as LogEntry } from "../../wallet/ui";
import { Card, ErrorText, hostOf, send, useFormatters } from "../components";

const STATUS_VARIANT: Record<string, "success" | "destructive" | "warning"> = {
  success: "success",
  error: "destructive",
  cancelled: "warning",
  timeout: "warning",
};

export function ActivityView() {
  const { t } = useI18n();
  const { timeAgo, duration } = useFormatters();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send<LogEntry[]>({ type: "ui:activity", limit: 100 })
      .then(setLogs)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : t("Activity.loadFailed")),
      );
  }, []);

  return (
    <Card title={t("Activity.title")} description={t("Activity.description")}>
      {logs.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-muted-foreground">{t("Activity.empty")}</p>
      ) : (
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr className="text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                <th className="px-1 pb-2 font-medium">{t("Activity.when")}</th>
                <th className="px-1 pb-2 font-medium">{t("Activity.app")}</th>
                <th className="px-1 pb-2 font-medium">{t("Activity.model")}</th>
                <th className="px-1 pb-2 font-medium">{t("Activity.status")}</th>
                <th className="px-1 pb-2 text-right font-medium">{t("Activity.time")}</th>
                <th className="px-1 pb-2 text-right font-medium">{t("Activity.tokens")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {logs.map((log) => (
                <tr key={log.id} className="align-middle">
                  <td className="px-1 py-2 whitespace-nowrap text-muted-foreground">
                    {timeAgo(log.startedAt)}
                  </td>
                  <td className="max-w-[110px] truncate px-1 py-2">{hostOf(log.origin)}</td>
                  <td className="max-w-[110px] truncate px-1 py-2 font-mono text-[11px]">
                    {log.model}
                  </td>
                  <td className="px-1 py-2">
                    <Badge variant={STATUS_VARIANT[log.status] ?? "default"}>
                      {t(`Activity.statuses.${log.status}`)}
                    </Badge>
                  </td>
                  <td className="tabular px-1 py-2 text-right whitespace-nowrap">
                    {duration(log.durationMs)}
                  </td>
                  <td className="tabular px-1 py-2 text-right whitespace-nowrap text-muted-foreground">
                    {log.inputTokens === undefined && log.outputTokens === undefined
                      ? "—"
                      : `${log.inputTokens ?? 0} → ${log.outputTokens ?? 0}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
