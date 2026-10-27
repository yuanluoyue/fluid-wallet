import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

/**
 * Cloudflare Workers deployment for the docs site.
 *
 * The site is fully prerendered, so the incremental cache only ever needs to
 * read: every page is baked into `.open-next/assets` at build time.
 */
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
  tagCache: "dummy",
  /**
   * Serve prerendered pages straight from the assets cache instead of booting
   * the Next.js server for them.
   *
   * Workers on the free plan cap CPU at 10ms per request, which a full RSC
   * render can exceed — and a page that times out never gets cached, so it
   * times out forever. With interception, a miss costs "route + read one JSON".
   *
   * Precondition: no PPR. If `experimental.ppr` is ever enabled, turn this off.
   */
  enableCacheInterception: true,
});
