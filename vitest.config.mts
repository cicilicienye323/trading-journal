import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
    env: {
      // Importing "@/env" runs validation at module load. Tests exercise the
      // schema through parseEnv() directly, so skip the module-level parse
      // rather than requiring a full valid environment to run the suite.
      SKIP_ENV_VALIDATION: "true",
    },
    // Next.js build output and e2e specs are not unit tests.
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**"],
    },
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json. Vitest does not read
    // tsconfig paths on its own, so this has to be kept in sync by hand.
    // This file is ESM, so there is no __dirname — resolve from import.meta.url.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
