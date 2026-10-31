import { useState } from "react";
import { browser } from "wxt/browser";

/**
 * Asks the browser for access to one provider origin.
 *
 * The permission prompt has to come from a click on a real page: a toolbar
 * popup is destroyed before the answer arrives, which is exactly why the wallet
 * opens this window instead of asking from the popup.
 *
 * The grant lives in the browser, not in the wallet — the provider row reads it
 * back with `permissions.contains`, so nothing has to be reported home here.
 */
export function GrantView({ origin }: { origin: string }) {
  const [status, setStatus] = useState<"idle" | "asking" | "granted" | "denied">("idle");
  const [error, setError] = useState<string | null>(null);

  const allow = async (): Promise<void> => {
    setStatus("asking");
    setError(null);
    try {
      const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) {
        setStatus("denied");
        return;
      }
      setStatus("granted");
      setTimeout(() => window.close(), 700);
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : "The browser refused the request.");
    }
  };

  if (!/^https?:\/\/[^/]+$/.test(origin)) {
    return (
      <div className="narrow">
        <h1 className="hero-title">Unknown site</h1>
        <p className="muted">The origin to allow is missing or malformed.</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => window.close()}>
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="narrow">
      <p className="badge">Provider access</p>
      <h1 className="hero-title" style={{ marginTop: 10 }}>
        Allow this site?
      </h1>
      <p className="mono">{origin}</p>
      <p className="muted" style={{ marginTop: 10 }}>
        Fluid Wallet calls this address on your behalf, using the key stored in the wallet. The
        browser asks once per host and remembers the answer.
      </p>
      {status === "granted" ? <p className="badge badge-ok">Access granted.</p> : null}
      {status === "denied" ? (
        <p className="badge badge-warn">
          Not granted. The provider stays saved, but calls to it will fail.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="stack" style={{ marginTop: 18 }}>
        <button
          className="btn btn-primary"
          onClick={() => void allow()}
          disabled={status === "asking" || status === "granted"}
        >
          {status === "granted"
            ? "Granted"
            : status === "asking"
              ? "Waiting for the browser…"
              : "Allow access"}
        </button>
        <button className="btn" onClick={() => window.close()}>
          Close
        </button>
      </div>
    </div>
  );
}
