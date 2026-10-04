import { defineConfig } from "vitest/config";

// Isolation suite: talks to a local Supabase. Kept out of the default `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["supabase/tests/isolation/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // One file, shared fixtures: run tests in order.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
