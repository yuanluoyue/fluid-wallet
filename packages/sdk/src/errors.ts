import { FluidError, FluidErrorCode } from "@fluid-wallet/protocol";

/**
 * Why a wallet call failed, in terms a page can render.
 *
 * A wallet refusal is not a transport failure: "the user has not approved this
 * app" and "the provider returned 500" both arrive as rejected promises, but
 * only one of them is something the person in front of the screen can fix.
 * Collapsing them into `catch (e) { show("something broke") }` is what makes a
 * wallet feel like a broken provider, so the mapping lives here rather than in
 * every app.
 */
export type FluidIssueKind =
  | "unavailable"
  | "locked"
  | "not-connected"
  | "denied"
  | "expired"
  | "model-not-allowed"
  | "provider"
  | "rate-limited"
  | "budget"
  | "cancelled"
  | "unknown";

/** What the person has to do. `none` means the failure is not theirs to fix. */
export type FluidIssueAction =
  "install" | "unlock" | "connect" | "approve" | "wait" | "fix-provider" | "retry" | "none";

export interface FluidIssue {
  kind: FluidIssueKind;
  action: FluidIssueAction;
  /** Short line for a banner. */
  title: string;
  /** One sentence explaining what happened, safe to show as-is. */
  detail: string;
  /** Present for rate limits, so a UI can count down instead of guessing. */
  retryAfterMs?: number;
  /** Counters behind an "unreachable wallet", for a bug report. */
  evidence?: string;
  /** Original protocol code, for logging. */
  code?: number;
}

/**
 * Turns the SDK's evidence into one line.
 *
 * These are the numbers an issue needs and a screenshot usually loses: how many
 * requests left the page, how many came back, and how long each probe waited
 * before giving up. Without them "not answering" is a feeling.
 */
function describeEvidence(raw: unknown): string {
  const data = raw as {
    diagnostics?: {
      relay: boolean;
      relayAnnouncedAfterMs?: number;
      requests: number;
      answers: number;
      pending?: number;
      last?: { method: string; answeredAfterMs?: number; error?: string };
    };
    attempts?: { outcome: string; elapsedMs: number; budgetMs: number }[];
  };

  const parts: string[] = [];
  const diagnostics = data.diagnostics;
  if (diagnostics) {
    parts.push(
      diagnostics.relay
        ? `relay up after ${diagnostics.relayAnnouncedAfterMs ?? 0}ms`
        : "relay never announced",
    );
    parts.push(
      `${diagnostics.requests} sent / ${diagnostics.answers} answered${diagnostics.pending ? ` / ${diagnostics.pending} still waiting` : ""}`,
    );
    if (diagnostics.last) {
      parts.push(
        `last ${diagnostics.last.method} ${diagnostics.last.answeredAfterMs === undefined ? "never came back" : `${diagnostics.last.answeredAfterMs}ms`}${diagnostics.last.error ? ` (${diagnostics.last.error})` : ""}`,
      );
    }
  }
  if (data.attempts?.length) {
    parts.push(
      `getInfo ${data.attempts.map((attempt) => `${attempt.outcome}@${attempt.elapsedMs}ms/${attempt.budgetMs}ms`).join(", ")}`,
    );
  }
  return parts.join(" · ");
}

const UNKNOWN: FluidIssue = {
  kind: "unknown",
  action: "retry",
  title: "The request did not complete",
  detail: "Something failed before the provider answered. Retrying usually tells you which.",
};

/** Maps any thrown value onto a renderable issue. */
export function describeFluidError(error: unknown): FluidIssue {
  if (!(error instanceof FluidError)) {
    return {
      ...UNKNOWN,
      detail: error instanceof Error ? error.message : UNKNOWN.detail,
    };
  }

  const data = (error.data ?? {}) as { retryAfterMs?: number; reason?: string };
  const base = { code: error.code };
  const withRetry =
    data.retryAfterMs === undefined ? base : { ...base, retryAfterMs: data.retryAfterMs };

  switch (error.code) {
    case FluidErrorCode.NotInstalled: {
      const evidence = describeEvidence(data);
      const withEvidence = evidence === "" ? base : { ...base, evidence };
      // Two different pages produce the same "nothing answered" from the
      // caller's side, and the fix differs: one is a missing extension, the
      // other is an installed extension whose worker is dead. The SDK knows
      // which one it is (there is a bridge or there is not), so it says so
      // rather than sending people to reinstall something that is already
      // there.
      if (data.reason === "no-relay") {
        return {
          ...withEvidence,
          kind: "unavailable",
          action: "retry",
          title: "Reload this page to reconnect",
          detail:
            "The wallet was reloaded or updated after this page opened. The page kept its old bridge, but the script that forwards requests to the extension is gone, so nothing can answer here. A reload fixes it; new page loads pick up the new build automatically.",
        };
      }

      if (data.reason === "worker-silent") {
        return {
          ...withEvidence,
          kind: "unavailable",
          action: "install",
          title: "The wallet is installed but not answering",
          detail:
            "The page has the wallet's bridge, so the extension did load — its background worker stopped responding. Open chrome://extensions, check Fluid Wallet for errors, press Reload on its card, then reload this page.",
        };
      }

      return {
        ...withEvidence,
        kind: "unavailable",
        action: "install",
        title: "No wallet found",
        detail:
          "No wallet script ran in this page, so `window.fluid` is undefined here. Load apps/extension/dist/chrome-mv3 in chrome://extensions and reload — that folder is the standalone build. A `pnpm dev:extension` build stops injecting the moment its dev server stops.",
      };
    }

    case FluidErrorCode.Locked:
      return {
        ...base,
        kind: "locked",
        action: "unlock",
        title: "The wallet is locked",
        detail:
          "Open the extension and unlock it with your password. Nothing was sent to the provider.",
      };

    case FluidErrorCode.Unauthorized:
      return {
        ...base,
        kind: "not-connected",
        action: "connect",
        title: "This site is not connected",
        detail: "Connect the wallet to ask for access. You will see exactly what it is asking for.",
      };

    case FluidErrorCode.PermissionDenied:
    case FluidErrorCode.Rejected:
      return {
        ...base,
        kind: "denied",
        action: "approve",
        title: "Permission was not granted",
        detail: error.message,
      };

    case FluidErrorCode.OriginMismatch:
      return {
        ...base,
        kind: "denied",
        action: "retry",
        title: "The wallet could not identify this page",
        detail: "Requests are only served to pages with a real origin. Reload and try again.",
      };

    case FluidErrorCode.SessionNotFound:
    case FluidErrorCode.SessionExpired:
      return {
        ...base,
        kind: "expired",
        action: "connect",
        title: "The session ended",
        detail:
          "Sessions are short-lived on purpose. Start a new one and the request can go through.",
      };

    case FluidErrorCode.ModelNotAllowed:
      return {
        ...base,
        kind: "model-not-allowed",
        action: "approve",
        title: "That model was not part of the grant",
        detail: error.message,
      };

    case FluidErrorCode.ProviderUnavailable:
      // `no-provider` is wallet state, not a provider refusing: the wallet has
      // nothing configured, and telling the user their key or balance is wrong
      // would send them to the wrong screen.
      if (data.reason === "no-provider") {
        return {
          ...base,
          kind: "provider",
          action: "fix-provider",
          title: "The wallet has no provider yet",
          detail:
            "Fluid Wallet has nothing configured to send this request to. Add a provider there, then connect again.",
        };
      }
      return {
        ...base,
        kind: "provider",
        action: "fix-provider",
        title: "The provider refused the request",
        detail: error.message,
      };

    case FluidErrorCode.InferenceFailed:
      return {
        ...base,
        kind: "provider",
        action: "fix-provider",
        title: "The provider refused the request",
        detail: error.message,
      };

    case FluidErrorCode.RateLimited:
      return {
        ...withRetry,
        kind: "rate-limited",
        action: "wait",
        title: "Too many requests",
        detail: "The wallet limits bursts per site. Wait a moment, then retry.",
      };

    case FluidErrorCode.BudgetExceeded:
      return {
        ...base,
        kind: "budget",
        action: "wait",
        title: "The daily budget is used up",
        detail: error.message,
      };

    case FluidErrorCode.InferenceCancelled:
      return {
        ...base,
        kind: "cancelled",
        action: "none",
        title: "Cancelled",
        detail: "The request was stopped before it finished.",
      };

    case FluidErrorCode.PayloadTooLarge:
    case FluidErrorCode.InvalidParams:
    case FluidErrorCode.InvalidRequest:
      return {
        ...base,
        kind: "unknown",
        action: "none",
        title: "The wallet rejected the request",
        detail: error.message,
      };

    case FluidErrorCode.Timeout:
      return {
        ...base,
        kind: "unknown",
        action: "retry",
        title: "The wallet did not answer in time",
        detail: "The page and the extension lost contact. Reload the page, then retry.",
      };

    default:
      return { ...base, ...UNKNOWN, detail: error.message };
  }
}

/** True when a human has to do something before a retry can succeed. */
export function needsUserAction(error: unknown): boolean {
  const { action } = describeFluidError(error);
  return action !== "none" && action !== "retry" && action !== "wait";
}
