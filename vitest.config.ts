import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    globalSetup: ["tests/global-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgres://mailwin:mailwin@localhost:5432/mailwin_test",
      ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
      APP_URL: "http://localhost:3000",
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
    },
  },
});
