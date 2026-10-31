import type { FluidPermissionRequest } from "@fluid-wallet/protocol";
import { browser } from "wxt/browser";

/** How long the approval window may stay open before the request is denied. */
const APPROVAL_TIMEOUT_MS = 120_000;

/**
 * Tells a toolbar panel that is already on screen to redraw.
 *
 * Deliberately not a `ui:*` message: those are commands the panel *sends*. This
 * one travels the other way, and is answered only by the panel, which is how the
 * worker learns whether a panel exists to draw into.
 */
export const APPROVAL_WAKE = "fluid:approval-available";

/** How long a panel gets to answer "I am here" before it is treated as closed. */
const PANEL_WAKE_TIMEOUT_MS = 1_000;

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
  void openApprovalSurface(id);
  return decision;
}

/**
 * The page asked to connect while the wallet has no provider to serve it.
 *
 * Approving a grant that reaches nothing would only move the failure one call
 * later, to a chat box with no explanation — so the request is refused now and
 * the window explains why, with the one screen that fixes it one click away.
 *
 * A page that retries in a loop must not stack windows, so an already-open one
 * for the same origin is focused instead.
 */
export async function openSetupWindow(origin: string): Promise<void> {
  const url = browser.runtime.getURL(`/options.html?view=setup&origin=${encodeURIComponent(origin)}`);
  try {
    const open = await findWindow(url);
    if (open !== undefined) {
      await browser.windows.update(open, { focused: true });
      return;
    }
    await browser.windows.create({ url, type: "popup", width: 460, height: 400 });
  } catch {
    // The refusal is what the page needs. A window that could not open makes it
    // less obvious, not less true, so it must not replace the real error.
  }
}

/** Window already showing `url`, if any. */
async function findWindow(url: string): Promise<number | undefined> {
  const windows = await browser.windows.getAll({ populate: true });
  for (const win of windows) {
    if (win.tabs?.some((tab) => tab.url === url)) return win.id;
  }
  return undefined;
}

/**
 * Puts the request where the user is most likely to look.
 *
 * The toolbar panel is the wallet's home: one click away, already the right
 * shape for this, and closing it does not discard the request — the panel is a
 * view over the worker's state, not the state itself. But a panel only exists
 * while it is open and there is no cross-browser way to summon one, so every
 * step below is best-effort and the window at the end always works.
 */
async function openApprovalSurface(id: string): Promise<void> {
  try {
    if (await wakePanel()) return;
    if (await openPanel()) return;
    await browser.windows.create({
      // WXT types `getURL` against the entrypoints it generated, so the leading
      // slash and the exact file name are both required.
      url: browser.runtime.getURL(`/options.html?approve=${id}`),
      type: "popup",
      width: 460,
      height: 640,
    });
  } catch (error) {
    // Without a surface there is no way to ask, so the request fails closed.
    decideApproval(id, "deny");
    console.warn("[fluid-wallet] could not open any approval surface", error);
  }
}

/**
 * Is a panel already on screen?
 *
 * A panel answers this message; nothing else does, which makes the answer the
 * same as "there is somewhere to draw right now". No receiver at all surfaces
 * as a rejected send, not as `false`.
 *
 * The deadline matters: a panel that is closing can swallow the message and
 * leave the answer pending until its port dies, which would stall `connect` in
 * the page. Reporting "no panel" a second late costs a window; hanging costs a
 * request.
 */
async function wakePanel(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), PANEL_WAKE_TIMEOUT_MS);
    });
    const answer = await Promise.race([
      browser.runtime.sendMessage({ type: APPROVAL_WAKE }),
      deadline,
    ]);
    return answer === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the browser to open the toolbar panel.
 *
 * `action.openPopup` is Chrome 127+ and absent elsewhere, and it rejects when
 * the panel is already open or when no user gesture is available. All of those
 * are "not this surface", so the caller falls through rather than guessing
 * which one it hit.
 */
async function openPanel(): Promise<boolean> {
  const action = browser.action as typeof browser.action | undefined;
  if (typeof action?.openPopup !== "function") return false;
  try {
    await action.openPopup();
    return true;
  } catch {
    return false;
  }
}
