import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: { root: import.meta.dirname },
  // pg picks its Cloudflare socket ("workerd" export) at bundle time; Next's file tracing only
  // copies the Node fallback, so ship the whole package for the Workers build.
  outputFileTracingIncludes: { "/**": ["./node_modules/pg-cloudflare/**/*"] },
};

export default nextConfig;
