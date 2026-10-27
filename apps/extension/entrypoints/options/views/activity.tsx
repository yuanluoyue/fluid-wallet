import { useEffect, useState } from "react";

import type { ActivityView as LogEntry } from "../../../src/wallet/ui";
import { Card, ErrorText, formatDuration, hostOf, send, timeAgo } from "../components";

const STATUS_CLASS: Record<string, string> = {
  success: "badge badge-ok",
  error: "badge badge-danger",
  cancelled: "badge badge-warn",
  timeout: "badge badge-warn",
};

export function ActivityView() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send<LogEntry[]>({ type: "ui:activity", limit: 100 })
      .then(setLogs)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load activity."),
      );
  }, []);

  return (
    <Card
      title="Activity"
      description="One row per model call. Prompts and answers are not logged here."
    >
      {logs.length === 0 ? (
        <p className="empty">No model calls yet.</p>
      ) : (
        <table className="logs">
          <thead>
            <tr>
              <th>When</th>
              <th>App</th>
              <th>Model</th>
              <th>Status</th>
              <th>Time</th>
              <th>Tokens</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id}>
                <td>{timeAgo(log.startedAt)}</td>
                <td>{hostOf(log.origin)}</td>
                <td className="mono">{log.model}</td>
                <td>
                  <span className={STATUS_CLASS[log.status] ?? "badge"}>{log.status}</span>
                </td>
                <td>{formatDuration(log.durationMs)}</td>
                <td>
                  {log.inputTokens === undefined && log.outputTokens === undefined
                    ? "—"
                    : `${log.inputTokens ?? 0} → ${log.outputTokens ?? 0}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ErrorText error={error} />
    </Card>
  );
}
