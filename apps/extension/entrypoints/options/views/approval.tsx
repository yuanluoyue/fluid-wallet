import { useEffect, useState } from "react";

import type { PendingApproval } from "../../../src/wallet/approval";
import { capabilityLabel, hostOf, send } from "../components";

/**
 * Shown in the popup window opened by `wallet.connect`.
 *
 * The decision is applied in the service worker, not here: this page only
 * reports the user's choice and closes.
 */
export function ApprovalView({ requestId }: { requestId: string }) {
  const [request, setRequest] = useState<PendingApproval | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send<PendingApproval[]>({ type: "ui:approvals" })
      .then((pending) => setRequest(pending.find((entry) => entry.id === requestId) ?? null))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Could not read the request."),
      );
  }, [requestId]);

  const decide = async (decision: "allow" | "always" | "deny"): Promise<void> => {
    try {
      await send({ type: "ui:decide", id: requestId, decision });
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the decision.");
    }
  };

  if (request === undefined) {
    return (
      <div className="narrow">
        <p className="muted">Loading request…</p>
      </div>
    );
  }

  if (request === null) {
    return (
      <div className="narrow">
        <h1 className="hero-title">Request expired</h1>
        <p className="muted">
          The connection request is no longer pending. Ask the app to connect again.
        </p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => window.close()}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <p className="badge">Connection request</p>
      <h1 className="hero-title" style={{ marginTop: 10 }}>
        {request.request.appName ?? hostOf(request.origin)}
      </h1>
      <p className="mono">{request.origin}</p>
      {request.request.reason ? <p className="muted">{request.request.reason}</p> : null}

      <section className="card" style={{ marginTop: 18 }}>
        <h2>It is asking for</h2>
        <div className="chips">
          {request.request.capabilities.map((capability) => (
            <span key={capability} className="chip">
              {capabilityLabel(capability)}
            </span>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          It never receives your API key — only answers. You can revoke this at any time.
        </p>
      </section>

      {error ? <p className="error">{error}</p> : null}

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={() => void decide("allow")}>
          Allow for 7 days
        </button>
        <button className="btn" onClick={() => void decide("always")}>
          Always allow
        </button>
        <button className="btn btn-danger" onClick={() => void decide("deny")}>
          Deny
        </button>
      </div>
    </div>
  );
}
