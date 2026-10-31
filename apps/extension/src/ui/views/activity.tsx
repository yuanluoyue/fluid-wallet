import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/react";
import type { ActivityView as LogEntry } from "../../wallet/ui";
import { Card, ErrorText, hostOf, send, useFormatters } from "../components";

const STATUS_CLASS: Record<string, string> = {
  success: "badge badge-ok",
  error: "badge badge-danger",
  cancelled: "badge badge-warn",
  timeout: "badge badge-warn",
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
        <p className="empty">{t("Activity.empty")}</p>
      ) : (
        <div className="table-wrap">
          <table className="logs">
            <thead>
              <tr>
                <th>{t("Activity.when")}</th>
                <th>{t("Activity.app")}</th>
                <th>{t("Activity.model")}</th>
                <th>{t("Activity.status")}</th>
                <th>{t("Activity.time")}</th>
                <th>{t("Activity.tokens")}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>{timeAgo(log.startedAt)}</td>
                  <td>{hostOf(log.origin)}</td>
                  <td className="mono">{log.model}</td>
                  <td>
                    <span className={STATUS_CLASS[log.status] ?? "badge"}>
                      {t(`Activity.statuses.${log.status}`)}
                    </span>
                  </td>
                  <td>{duration(log.durationMs)}</td>
                  <td>
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
