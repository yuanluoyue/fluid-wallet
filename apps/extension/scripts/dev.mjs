import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * `wxt` in dev mode, with the one sharp edge filed down.
 *
 * The dev build is not a standalone extension: `popup.html` points at the dev
 * server and `content_scripts` are registered over its websocket instead of
 * living in the manifest. Stop the process and the folder on disk is a wallet
 * that loads, opens a blank panel, and answers no page at all — no
 * `window.fluid`, so every app reports "no wallet found".
 *
 * People load that folder, stop the process, and then debug the wrong thing.
 * So the folder is deleted when this process exits: a half-extension cannot
 * outlive the server that makes it whole. The production build in
 * `dist/chrome-mv3` is untouched and keeps working.
 *
 * Chrome's "Load unpacked" picker cannot be scripted — it is a native dialog —
 * so the path still has to be selected by hand. All this can do is say where,
 * and refuse to leave a trap behind.
 */
const root = fileURLToPath(new URL("..", import.meta.url));
const devDir = `${root}dist/chrome-mv3-dev`;
const prodDir = `${root}dist/chrome-mv3`;

console.log("");
console.log(`  Fluid Wallet dev server → ${devDir}`);
console.log(`  Load that folder once: chrome://extensions → Developer mode → Load unpacked.`);
console.log(`  It edits live, and it is deleted when you press Ctrl-C — a dev build without`);
console.log(`  its server injects nothing. For a folder that stands on its own:`);
console.log(`  pnpm build:extension → ${prodDir}`);
console.log("");

const child = spawn(`${root}node_modules/.bin/wxt`, [], { cwd: root, stdio: "inherit" });

let cleaned = false;
function cleanUp() {
  if (cleaned) return;
  cleaned = true;
  try {
    rmSync(devDir, { recursive: true, force: true });
    console.log(`\n  Removed ${devDir}. It cannot work without the server that just stopped.`);
    console.log(`  Still pointing Chrome at it? Reload it against ${prodDir} instead.\n`);
  } catch {
    // Best effort: a leftover folder is only a problem if someone loads it.
  }
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    child.kill(signal);
  });
}

child.on("exit", (code) => {
  cleanUp();
  process.exit(code ?? 0);
});
