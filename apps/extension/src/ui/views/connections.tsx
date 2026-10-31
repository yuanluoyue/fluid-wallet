import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/react";
import type { ConnectionView } from "../../wallet/ui";
import { Card, ErrorText, hostOf, send, useFormatters } from "../components";

export function ConnectionsView() {
  const { t } = useI18n();
  const { timeAgo, dateTime, capability } = useFormatters();
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  // A second click instead of `window.confirm`: a native dialog can dismiss the
  // toolbar panel, and then the answer never comes back to this component.
  const [confirming, setConfirming] = useState(false);
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
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Connections.revokeAllFailed"));
    }
  };

  return (
    <Card title={t("Connections.title")} description={t("Connections.description")}>
      {connections.length > 0 ? (
        confirming ? (
          <div className="actions">
            <button className="btn btn-danger" onClick={() => void revokeAll()}>
              {t("Connections.revokeAllConfirm", { count: connections.length })}
            </button>
            <button className="btn" onClick={() => setConfirming(false)}>
              {t("Connections.keep")}
            </button>
          </div>
        ) : (
          <button className="btn btn-danger" onClick={() => setConfirming(true)}>
            {t("Connections.revokeAll", { count: connections.length })}
          </button>
        )
      ) : null}
      {connections.length === 0 ? (
        <p className="empty">{t("Connections.empty")}</p>
      ) : (
        connections.map((connection) => (
          <div className="item" key={connection.origin}>
            <div>
              <div className="item-title">{hostOf(connection.origin)}</div>
              <div className="mono">{connection.origin}</div>
              <div className="chips">
                {connection.capabilities.map((scope) => (
                  <span className="chip" key={scope}>
                    {capability(scope)}
                  </span>
                ))}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                {t("Connections.granted", { when: timeAgo(connection.grantedAt) })}
                {connection.expiresAt
                  ? ` · ${t("Connections.expires", { when: dateTime(connection.expiresAt) })}`
                  : ""}
                {connection.providers.length
                  ? ` · ${connection.providers.join(", ")}`
                  : ` · ${t("Connections.allProviders")}`}
              </div>
              <div className="muted" style={{ marginTop: 2 }}>
                {connection.dailyLimit > 0
                  ? t("Connections.today", {
                      used: connection.requestsToday,
                      limit: connection.dailyLimit,
                    })
                  : t("Connections.todayNoLimit", { used: connection.requestsToday })}
              </div>
            </div>
            <button className="btn btn-danger" onClick={() => void revoke(connection.origin)}>
              {t("Connections.revoke")}
            </button>
          </div>
        ))
      )}
      <ErrorText error={error} />
    </Card>
  );
}
