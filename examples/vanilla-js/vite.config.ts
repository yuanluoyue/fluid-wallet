import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pkg = (name: string) =>
  fileURLToPath(new URL(`../../packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  server: {
    port: 5175,
  },
  resolve: {
    alias: {
      "@fluid-wallet/protocol": pkg("protocol"),
      "@fluid-wallet/sdk": pkg("sdk"),
    },
  },
});
