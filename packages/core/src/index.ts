/**
 * The wallet kernel: everything that only ever runs inside the extension.
 *
 * One entry point on purpose. The four directories below are layers, not
 * packages — `crypto` knows nothing, `storage` may read `crypto`, `providers`
 * talks to the outside world, and `runtime` makes the decisions. Keeping them
 * as directories means adding a helper costs no manifest edits; the ordering
 * is enforced by the lint rule in the root `eslint.config.mjs` rather than by
 * the package manager, which is the price of not having four package.json
 * files for ~3 000 lines that one app consumes.
 *
 * Nothing here is published: it assumes IndexedDB, Web Crypto and a service
 * worker, and it encodes our choices rather than an interface worth promising
 * to other wallet implementations. The public surface for those is
 * `@fluid-wallet/protocol`.
 */
export * from "./crypto";
export * from "./providers";
export * from "./runtime";
export * from "./storage";
