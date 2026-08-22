import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Netlify scheduled/serverless functions must default-export the handler
    // directly — a named function assigned first isn't the documented shape.
    files: ["netlify/functions/**"],
    rules: { "import/no-anonymous-default-export": "off" },
  },
]);

export default eslintConfig;
