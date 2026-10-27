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
    host_permissions: ["https://api.deepseek.com/*"],
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
