import tseslint from "typescript-eslint";

/** Shared shape for the layering rules below. */
const forbid = (group, message) => ["error", { patterns: [{ group, message }] }];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/coverage/**",
      "**/*.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // `debug` is the diagnostics verb: it is filtered out of normal consoles
      // and is how the wallet explains a failed hop (page → relay → worker).
      "no-console": ["warn", { allow: ["warn", "error", "debug"] }],
    },
  },

  // ---------------------------------------------------------------------------
  // Package layering
  //
  // Merging nine packages into three deleted the manifests that used to make
  // these directions unrepresentable, so they are stated once, here. Without
  // this the split erodes the first time someone needs "just one helper" from
  // the layer above.
  // ---------------------------------------------------------------------------
  {
    files: ["packages/protocol/**/*.ts"],
    rules: {
      "no-restricted-imports": forbid(
        ["@fluid-wallet/*"],
        "protocol is the bottom layer and ships to third parties with zero dependencies.",
      ),
    },
  },
  {
    files: ["packages/sdk/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": forbid(
        ["@fluid-wallet/core"],
        "The SDK is what apps install; the wallet kernel is private and would drag Dexie into every consumer.",
      ),
    },
  },
  {
    files: ["packages/core/**/*.ts"],
    rules: {
      "no-restricted-imports": forbid(
        ["@fluid-wallet/sdk", "@fluid-wallet/sdk/*"],
        "The wallet implements the protocol, it does not consume our client SDK.",
      ),
    },
  },
  // The extension's dev launcher is a CLI: printing the folder to load is its
  // entire output, so the warning that exists to keep `console.log` out of
  // shipped code does not apply to it.
  {
    files: ["apps/extension/scripts/**/*.mjs"],
    rules: { "no-console": "off" },
  },
  // Inside core the four directories are layers, not peers:
  //   crypto  → nothing (Web Crypto only)
  //   storage → crypto
  //   providers → nothing (talks to the network, holds no state)
  //   runtime → all of the above
  {
    files: ["packages/core/src/crypto/**/*.ts"],
    rules: {
      "no-restricted-imports": forbid(
        [
          "../storage",
          "../storage/*",
          "../providers",
          "../providers/*",
          "../runtime",
          "../runtime/*",
        ],
        "crypto is the bottom of the kernel: keep it free of storage, network and policy.",
      ),
    },
  },
  {
    files: ["packages/core/src/providers/**/*.ts"],
    rules: {
      "no-restricted-imports": forbid(
        ["../crypto", "../crypto/*", "../storage", "../storage/*", "../runtime", "../runtime/*"],
        "Provider adapters are stateless transport: they must not reach into keys, storage or policy.",
      ),
    },
  },
  {
    files: ["packages/core/src/storage/**/*.ts"],
    rules: {
      "no-restricted-imports": forbid(
        ["../providers", "../providers/*", "../runtime", "../runtime/*"],
        "storage persists what it is given; it does not call providers or decide permissions.",
      ),
    },
  },
);
