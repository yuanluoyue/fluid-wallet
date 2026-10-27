// Custom Worker entry: wraps the OpenNext-generated worker.
// Add `scheduled()` or `queue()` handlers here if the site ever needs them.

// @ts-expect-error - resolved by wrangler at build time, not by tsc
import openNextWorker from "./.open-next/worker.js";

export default {
  fetch: openNextWorker.fetch,
};
