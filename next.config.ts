import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;

// `next dev` gets the Worker's bindings (the local D1 database) from Wrangler. Only in dev:
// during `next build` it would start a local Workers runtime for nothing.
if (process.env.NODE_ENV === "development") initOpenNextCloudflareForDev();
