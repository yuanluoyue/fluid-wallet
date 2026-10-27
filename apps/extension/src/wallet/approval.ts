import { FluidError, FluidErrorCode, type FluidPermissionRequest } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

/** How long the approval window may stay open before the request is denied. */
const APPROVAL_TIMEOUT_MS = 120_000;

export type ApprovalDecision = "allow" | "always" | "deny";

export interface PendingApproval {
  id: string;
  origin: string;
  request: FluidPermissionRequest;
  createdAt: number;
}

interface Entry extends PendingApproval {
  settle: (decision: ApprovalDecision) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, Entry>();
const byOrigin = new Map<string, Promise<ApprovalDecision>>();

export function listPending(): PendingApproval[] {
  return [...pending.values()].map(({ id, origin, request, createdAt }) => ({
    id,
    origin,
    request,
    createdAt,
  }));
}

export function getPending(id: string): PendingApproval | null {
  const entry = pending.get(id);
  if (!entry) return null;
  return { id: entry.id, origin: entry.origin, request: entry.request, createdAt: entry.createdAt };
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

    pending.set(id, { id, origin, request, createdAt: Date.now(), settle: resolve, timer });
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
