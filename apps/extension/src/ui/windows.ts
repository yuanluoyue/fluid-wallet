import { browser } from "wxt/browser";

/**
 * Actions Chrome refuses to run inside a toolbar popup.
 *
 * The popup is a renderer that dies the moment focus leaves it, and a native
 * prompt — the host-permission dialog, the file picker — always takes focus. So
 * these two flows get a small window of their own, opened from the popup. It is
 * deliberately not a tab: the user is mid-task and gets the same panel-sized
 * surface back when it closes.
 */
function openPanel(url: string, width: number, height: number): void {
  void browser.windows.create({ url, type: "popup", width, height });
}

/** Asks the browser for access to one provider origin, e.g. `https://api.deepseek.com`. */
export function openGrantWindow(origin: string): void {
  const url = browser.runtime.getURL(
    `/options.html?view=grant&origin=${encodeURIComponent(origin)}`,
  );
  openPanel(url, 460, 350);
}

/** Restoring a backup needs a file picker, which the popup cannot survive. */
export function openImportWindow(): void {
  openPanel(browser.runtime.getURL("/options.html?view=import"), 480, 430);
}
