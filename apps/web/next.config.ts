import type { NextConfig } from "next";

const config: NextConfig = {
  htmlLimitedBots: /./,
  experimental: { inlineCss: true },
  // the engine is imported straight from packages/core/src (TypeScript) — one rebut() for CLI and web
  transpilePackages: ["@rebuttal/core"],
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // lib/guard.ts replays a recorded fixture once the day's live credit budget is spent — ship them with the function
  outputFileTracingIncludes: { "/api/rebut": ["../../fixtures/*.json"], "/api/og": ["../../fixtures/*.json"], "/c": ["../../fixtures/*.json"] },
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
  turbopack: { resolveExtensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"] },
};
export default config;
