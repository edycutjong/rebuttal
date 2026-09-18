import { defineConfig } from "vitest/config";
export default defineConfig({
  oxc: { jsx: { runtime: "automatic" } },
  esbuild: { jsx: "automatic" },
  test: {
    testTimeout: 60_000,
    include: ["packages/**/test/**/*.test.ts"],
    environment: "node",
    coverage: { provider: "v8", include: ["packages/core/src/**"], reporter: ["text", "html", "lcov"], reportsDirectory: "coverage" },
  },
  resolve: {
    alias: {
      "@rebuttal/core": new URL("./packages/core/src/index.ts", import.meta.url).pathname,
      "@": new URL("./apps/web", import.meta.url).pathname,
    },
  },
});
