import { fileURLToPath } from "node:url";

/**
 * Chrome cannot be told "watch this folder from now on", so loading the build
 * stays manual — all this script can do is say where the folder is.
 *
 * The folder is `dist/` rather than WXT's default `.output/` on purpose: the
 * picker behind "Load unpacked" does not show dot-folders, and that is the one
 * path the user has to find by hand.
 *
 * The dev build is not self-contained, and that surprises people at the worst
 * moment. `wxt dev` writes `popup.html` pointing at `http://localhost:3000` and
 * leaves `content_scripts` out of the manifest — both are registered over the
 * dev server's websocket. Stop the server and the extension goes quiet: blank
 * popup, no `window.fluid`, and every page reports "No wallet found". Saying so
 * up front is cheaper than debugging it later.
 */
const dev = fileURLToPath(new URL("../dist/chrome-mv3-dev", import.meta.url));
const production = fileURLToPath(new URL("../dist/chrome-mv3", import.meta.url));

console.log("");
console.log(`  Fluid Wallet dev → ${dev}`);
console.log("  Load it: chrome://extensions → Developer mode → Load unpacked → that folder");
console.log("");
console.log("  This build only works while this process is running. The dev server serves");
console.log("  its pages and registers its content scripts, so stopping it leaves a blank");
console.log("  popup and pages reporting \"No wallet found\".");
console.log(`  For a build that stands on its own: pnpm build:extension → ${production}`);
console.log("  (A different folder is a different extension id, so it starts with an empty wallet.)");
console.log("");
