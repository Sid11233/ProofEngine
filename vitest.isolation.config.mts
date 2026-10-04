import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Isolation suite: talks to a local Supabase. Kept out of the default `npm test`.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./src/test/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["supabase/tests/isolation/**/*.test.ts", "src/**/*.integration.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One file, shared fixtures: run tests in order.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
