import type { NextConfig } from "next";

const config: NextConfig = {
  htmlLimitedBots: /./,
  experimental: { inlineCss: true },
  // the engine is imported straight from packages/core/src (TypeScript) — one rebut() for CLI and web
  transpilePackages: ["@rebuttal/core"],
  outputFileTracingRoot: new URL("../../", import.meta.url).pathname,
  // lib/guard.ts replays a recorded fixture once the day's live credit budget is spent — ship them with the function
  outputFileTracingIncludes: { "/api/rebut": ["../../fixtures/*.json"], "/api/og": ["../../fixtures/*.json"], "/c": ["../../fixtures/*.json"] },
  turbopack: {},
  // Next 16 dev writes AGENTS.md / CLAUDE.md into apps/web by default — this repo is public and keeps no agent files
  agentRules: false,
};
export default config;
