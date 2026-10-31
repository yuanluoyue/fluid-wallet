import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/react";
import type { PendingApproval } from "../../wallet/approval";
import { hostOf, send, useFormatters } from "../components";

/**
 * Shown in the popup window opened by `wallet.connect`.
 *
 * The decision is applied in the service worker, not here: this page only
 * reports the user's choice and closes.
 */
export function ApprovalView({ requestId }: { requestId: string }) {
  const { t } = useI18n();
  const { capability } = useFormatters();
  const [request, setRequest] = useState<PendingApproval | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void send<PendingApproval[]>({ type: "ui:approvals" })
      .then((pending) => setRequest(pending.find((entry) => entry.id === requestId) ?? null))
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : t("Approval.loadFailed")),
      );
  }, [requestId]);

  const decide = async (decision: "allow" | "always" | "deny"): Promise<void> => {
    try {
      await send({ type: "ui:decide", id: requestId, decision });
      window.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Approval.decideFailed"));
    }
  };

  if (request === undefined) {
    return (
      <div className="narrow">
        <p className="muted">{t("Approval.loading")}</p>
      </div>
    );
  }

  if (request === null) {
    return (
      <div className="narrow">
        <h1 className="hero-title">{t("Approval.expiredTitle")}</h1>
        <p className="muted">{t("Approval.expiredBody")}</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => window.close()}>
          {t("Common.close")}
        </button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <p className="badge">{t("Approval.badge")}</p>
      <h1 className="hero-title" style={{ marginTop: 10 }}>
        {request.request.appName ?? hostOf(request.origin)}
      </h1>
      <p className="mono">{request.origin}</p>
      {request.context.firstConnection ? (
        <p className="badge badge-warn">{t("Approval.firstTime")}</p>
      ) : (
        <p className="badge badge-ok">{t("Approval.again")}</p>
      )}
      {request.context.nameMismatch ? (
        <p className="badge badge-danger">{t("Approval.nameMismatch")}</p>
      ) : null}
      {request.request.reason ? <p className="muted">{request.request.reason}</p> : null}

      <section className="card" style={{ marginTop: 18 }}>
        <h2>{t("Approval.askingFor")}</h2>
        <div className="chips">
          {request.request.capabilities.map((scope) => (
            <span key={scope} className="chip">
              {capability(scope)}
            </span>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          {t("Approval.neverSeesKey")}
        </p>
      </section>

      {request.context.providerNames.length ? (
        <section className="card">
          <h2>{t("Approval.willUse")}</h2>
          <p className="muted">
            {request.context.providerNames.join(", ")}
            {request.context.defaultModel
              ? ` · ${t("Approval.defaultModel", { model: request.context.defaultModel })}`
              : ""}
          </p>
          <p className="hint">{t("Approval.billed")}</p>
        </section>
      ) : null}

      {request.request.capabilities.includes("inference:proxy") ? (
        <section className="card">
          <h2>{t("Approval.directAccess")}</h2>
          <p className="muted">{t("Approval.directAccessBody")}</p>
        </section>
      ) : null}

      {error ? <p className="error">{error}</p> : null}

      <div className="stack" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={() => void decide("allow")}>
          {t("Approval.allow7")}
        </button>
        <button className="btn" onClick={() => void decide("always")}>
          {t("Approval.allowAlways")}
        </button>
        <button className="btn btn-danger" onClick={() => void decide("deny")}>
          {t("Approval.deny")}
        </button>
      </div>
    </div>
  );
}
