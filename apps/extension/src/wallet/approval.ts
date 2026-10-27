import { FluidError, FluidErrorCode, type FluidPermissionRequest } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

/** How long the approval window may stay open before the request is denied. */
const APPROVAL_TIMEOUT_MS = 120_000;

export type ApprovalDecision = "allow" | "always" | "deny";

/**
 * Everything the approval window needs beyond the raw request.
 *
 * Filled in by the dispatcher, which is the only place that can see the wallet
 * as a whole: whether this origin has connected before, and which providers the
 * grant would actually reach.
 */
export interface ApprovalContext {
  firstConnection: boolean;
  providerNames: string[];
  defaultModel?: string;
  /**
   * The app calls itself something the origin does not own.
   *
   * Not proof of anything — an app may legitimately mention the provider it
   * uses — but a name that points at another domain is exactly what an
   * impersonating page looks like, and the user is the only one who can judge.
   */
  nameMismatch: boolean;
}

export interface PendingApproval {
  id: string;
  origin: string;
  request: FluidPermissionRequest;
  context: ApprovalContext;
  createdAt: number;
}

interface Entry extends PendingApproval {
  settle: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Entry>();
const byOrigin = new Map<string, Promise<ApprovalDecision>>();

export function listPending(): PendingApproval[] {
  return [...pending.values()].map(({ id, origin, request, context, createdAt }) => ({
    id,
    origin,
    request,
    context,
    createdAt,
  }));
}

export function getPending(id: string): PendingApproval | null {
  const entry = pending.get(id);
  if (!entry) return null;
  return {
    id: entry.id,
    origin: entry.origin,
    request: entry.request,
    context: entry.context,
    createdAt: entry.createdAt,
  };
}

/**
 * Applies a decision coming from the approval window.
 *
 * Returns false when the id is unknown, which happens if the service worker
 * restarted while the window was open — the page already got a denial.
 */
export function decideApproval(id: string, decision: ApprovalDecision): boolean {
  const entry = pending.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pending.delete(id);
  byOrigin.delete(entry.origin);
  entry.settle(decision);
  return true;
}

/**
 * Asks the user to approve a connection.
 *
 * Approval is origin-scoped: a second tab asking for more capabilities while a
 * window is already open joins the existing request instead of stacking popups.
 */
export function requestApproval(
  origin: string,
  request: FluidPermissionRequest,
  context: ApprovalContext,
): Promise<ApprovalDecision> {
  const existing = byOrigin.get(origin);
  if (existing) return existing;

  const id = crypto.randomUUID();
  const decision = new Promise<ApprovalDecision>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      byOrigin.delete(origin);
      resolve("deny");
    }, APPROVAL_TIMEOUT_MS);

    pending.set(id, { id, origin, request, context, createdAt: Date.now(), settle: resolve, timer });
  });

  byOrigin.set(origin, decision);
  void openApprovalWindow(id);
  return decision;
}

async function openApprovalWindow(id: string): Promise<void> {
  // WXT types `getURL` against the entrypoints it generated, so the leading
  // slash and the exact file name are both required.
  const url = browser.runtime.getURL(`/options.html?approve=${id}`);
  try {
    await browser.windows.create({ url, type: "popup", width: 460, height: 640 });
  } catch (error) {
    // Without a window there is no way to ask, so the request fails closed.
    decideApproval(id, "deny");
    throw new FluidError(
      FluidErrorCode.Rejected,
      "Could not open the approval window.",
      error instanceof Error ? error.message : undefined,
    );
  }
}
