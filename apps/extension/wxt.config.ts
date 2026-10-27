import { fileURLToPath } from "node:url";
import { defineConfig } from "wxt";

/** Workspace packages are consumed from source so the extension never needs a stale `dist`. */
const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Fluid Wallet",
    description: "Local-first LLM wallet for web AI applications.",
    permissions: ["storage"],
    // Only the default provider is pre-granted. Every other endpoint is asked
    // for at the moment the user adds it, so installing the wallet does not
    // hand it access to every host on the web.
    host_permissions: ["https://api.deepseek.com/*"],
    optional_host_permissions: ["https://*/*"],
  },
  vite: () => ({
    resolve: {
      alias: {
        "@fluid-wallet/crypto": pkg("crypto"),
        "@fluid-wallet/protocol": pkg("protocol"),
        "@fluid-wallet/providers": pkg("providers"),
        "@fluid-wallet/runtime": pkg("runtime"),
        "@fluid-wallet/sdk": pkg("sdk"),
        "@fluid-wallet/storage": pkg("storage"),
      },
    },
  }),
});
