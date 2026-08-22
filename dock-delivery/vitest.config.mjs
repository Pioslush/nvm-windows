import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    // Mirrors the "@/*" -> "./*" path alias in tsconfig.json, so tests can
    // import application code the same way the app does.
    // Plain .mjs (not .ts): Vite loads it natively, with no temp-file
    // transform — which test-db.sh's unprivileged re-exec cannot write.
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
