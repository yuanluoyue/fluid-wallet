import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests import workspace packages by their public name. Resolving them straight
 * to `src` keeps the test run independent from a prior `pnpm build`.
 */
const pkg = (name: string) =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@fluid-wallet\/protocol$/, replacement: pkg("protocol") },
      { find: /^@fluid-wallet\/sdk$/, replacement: pkg("sdk") },
      { find: /^@fluid-wallet\/ai-sdk$/, replacement: pkg("ai-sdk") },
      { find: /^@fluid-wallet\/react$/, replacement: pkg("react").replace(/index\.ts$/, "index.tsx") },
      { find: /^@fluid-wallet\/runtime$/, replacement: pkg("runtime") },
      { find: /^@fluid-wallet\/storage$/, replacement: pkg("storage") },
      { find: /^@fluid-wallet\/crypto$/, replacement: pkg("crypto") },
      { find: /^@fluid-wallet\/providers$/, replacement: pkg("providers") },
      { find: /^@fluid-wallet\/test-kit$/, replacement: pkg("test-kit") },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
