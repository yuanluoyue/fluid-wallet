import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // OpenNext builds from the standalone output.
  output: "standalone",
  reactStrictMode: true,
  // Workers cannot run the Next image optimizer; images are served as-is.
  images: { unoptimized: true },
};

// Keeps `next dev` on the same runtime code path as the deployed Worker, so a
// binding that works locally does not break at the edge.
if (process.env.NODE_ENV === "development") {
  initOpenNextCloudflareForDev();
}

export default nextConfig;
