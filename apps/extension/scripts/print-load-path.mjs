import { fileURLToPath } from "node:url";

/**
 * `wxt dev` only builds and watches — Chrome cannot be told "watch this folder
 * from now on", so loading the build stays manual. All a dev run needs to say
 * is where that build lands.
 *
 * The folder is `dist/` rather than WXT's default `.output/` on purpose: the
 * picker behind "Load unpacked" does not show dot-folders, and that is the one
 * path the user has to find by hand.
 */
const output = fileURLToPath(new URL("../dist/chrome-mv3-dev", import.meta.url));

console.log("");
console.log(`  Fluid Wallet dev → ${output}`);
console.log("  chrome://extensions → Developer mode → Load unpacked → pick that folder");
console.log("  Rebuilds land in the same folder; ⟳ on the card reloads the extension.");
console.log("");
