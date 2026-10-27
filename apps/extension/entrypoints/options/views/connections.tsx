import { useEffect, useState } from "react";

import type { ConnectionView } from "../../../src/wallet/ui";
import { capabilityLabel, Card, ErrorText, hostOf, send, timeAgo } from "../components";

export function ConnectionsView() {
  const [connections, setConnections] = useState<ConnectionView[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send<ConnectionView[]>({ type: "ui:connections" })
      .then(setConnections)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not load connections."),
      );
  }, []);

  const revoke = async (origin: string): Promise<void> => {
    try {
      setConnections(await send<ConnectionView[]>({ type: "ui:revoke", origin }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the connection.");
    }
  };

  return (
    <Card
      title="Connected apps"
      description="Each origin gets its own grant. Revoking closes its sessions immediately."
    >
      {connections.length === 0 ? (
        <p className="empty">No app has connected to this wallet yet.</p>
      ) : (
        connections.map((connection) => (
          <div className="item" key={connection.origin}>
            <div>
              <div className="item-title">{hostOf(connection.origin)}</div>
              <div className="mono">{connection.origin}</div>
              <div className="chips">
                {connection.capabilities.map((capability) => (
                  <span className="chip" key={capability}>
                    {capabilityLabel(capability)}
                  </span>
                ))}
              </div>
              <div className="muted" style={{ marginTop: 6 }}>
                Granted {timeAgo(connection.grantedAt)}
                {connection.expiresAt ? ` · expires ${new Date(connection.expiresAt).toLocaleString()}` : ""}
                {connection.providers.length ? ` · ${connection.providers.join(", ")}` : " · all providers"}
              </div>
              <div className="muted" style={{ marginTop: 2 }}>
                {connection.dailyLimit > 0
                  ? `${connection.requestsToday} / ${connection.dailyLimit} requests today`
                  : `${connection.requestsToday} requests today · no daily limit`}
              </div>
            </div>
            <button className="btn btn-danger" onClick={() => void revoke(connection.origin)}>
              Revoke
            </button>
          </div>
        ))
      )}
      <ErrorText error={error} />
    </Card>
  );
}
