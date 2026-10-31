import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

/** Workspace packages are consumed from source so the extension never needs a stale `dist`. */
const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Not the default `.output`: a dot-folder is hidden in Chrome's "Load
  // unpacked" picker, so the one path the user has to select by hand would be
  // the one the picker hides.
  outDir: "dist",
  manifest: {
    name: "Fluid Wallet",
    description: "Local-first LLM wallet for web AI applications.",
    // `idle` is only used to notice the OS screen lock: a wallet that stays
    // unlocked while the user walks away is the classic local-attack window.
    permissions: ["storage", "idle"],
    // Only the default provider is pre-granted. Every other endpoint is asked
    // for at the moment the user adds it, so installing the wallet does not
    // hand it access to every host on the web.
    host_permissions: ["https://api.deepseek.com/*"],
    optional_host_permissions: ["https://*/*"],
  },
  // `wxt dev` builds and watches; it does not load the extension anywhere.
  // Chrome cannot be told "watch this folder from now on", and the launcher WXT
  // uses would start a throwaway profile — which means setting the master
  // password and re-adding the provider key on every restart. Loading the built
  // folder by hand keeps one real profile, so `dev` only prints where the build
  // lands.
  webExt: {
    disabled: true,
  },
  vite: () => ({
    resolve: {
      alias: {
        "@fluid-wallet/core": pkg("core"),
        "@fluid-wallet/protocol": pkg("protocol"),
        "@fluid-wallet/sdk": pkg("sdk"),
      },
    },
  }),
});
