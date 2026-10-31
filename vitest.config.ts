import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Tests import workspace packages by their public name. Resolving them straight
 * to `src` keeps the test run independent from a prior `pnpm build`.
 *
 * The patterns are anchored, so `@fluid-wallet/sdk/ai` never falls through to
 * the `@fluid-wallet/sdk` rule regardless of declaration order.
 */
const src = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@fluid-wallet\/protocol$/, replacement: src("protocol/src/index.ts") },
      { find: /^@fluid-wallet\/sdk\/react$/, replacement: src("sdk/src/react/index.tsx") },
      { find: /^@fluid-wallet\/sdk\/ai$/, replacement: src("sdk/src/ai/index.ts") },
      { find: /^@fluid-wallet\/sdk\/testing$/, replacement: src("sdk/src/testing/index.ts") },
      { find: /^@fluid-wallet\/sdk$/, replacement: src("sdk/src/index.ts") },
      { find: /^@fluid-wallet\/core$/, replacement: src("core/src/index.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    testTimeout: 10_000,
  },
});
