import { fileURLToPath } from "node:url";

/**
 * `wxt dev` only builds and watches — Chrome cannot be told "watch this folder
 * from now on", so loading the build stays manual. All a dev run needs to say
 * is where that build lands.
 */
const output = fileURLToPath(new URL("../.output/chrome-mv3-dev", import.meta.url));

console.log("");
console.log(`  Fluid Wallet dev → ${output}`);
console.log("  chrome://extensions → Developer mode → Load unpacked → ⌘⇧G to paste");
console.log("  Rebuilds land in the same folder; ⟳ on the card reloads the extension.");
console.log("");
