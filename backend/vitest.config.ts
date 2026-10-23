import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      LLM_MODE: "mock",
      LOG_LEVEL: "warn",
      // Integration tests use their own database and Redis DB index so they never touch dev data.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://wfo:wfo@127.0.0.1:55432/wfo_test",
      REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://127.0.0.1:56379/15",
    },
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
