import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "**/test-results/**",
    ],
  },
  js.configs.recommended,
  // Type-aware rules catch unhandled promises, which matter in socket and timer code.
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allows `const { a, ...rest } = obj` to omit a field without an unused-variable error.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs}"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["apps/**/*.{ts,tsx}", "packages/ui/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["server/**/*.ts", "sensor/**/*.ts"],
    languageOptions: { globals: globals.node },
  },
  // Import boundaries: each layer may use only the layers under it. Type
  // imports are allowed, because they do not exist at run time.
  boundary(
    ["apps/*/src/domain/**", "apps/control/src/state/**"],
    "Domain code is pure: no React, no state library, no UI and no I/O.",
    [
      "react",
      "react-*",
      "@reduxjs/*",
      "recharts",
      "../components/*",
      "@app/client",
      "../store/*",
      "../hooks/*",
      "../data/*",
      "../App",
    ],
  ),
  boundary(
    ["apps/*/src/data/**", "apps/*/src/store/**"],
    "Data and state do not use the UI or the relay connection.",
    ["../components/*", "@app/client", "../App"],
  ),
  boundary(
    ["apps/*/src/components/**"],
    "Components get data and callbacks as props; they never use the relay.",
    ["@app/client", "../App"],
  ),
  boundary(
    ["sensor/src/domain/**"],
    "Domain code is pure: no transport, no data source and no Node I/O.",
    ["../transport/*", "../data/*", "../agent", "ws", "node:*"],
  ),
  boundary(
    ["sensor/src/data/**"],
    "The data source does not know the transport.",
    ["../transport/*", "../agent"],
  ),
  boundary(
    [
      "server/src/routing.ts",
      "server/src/rateLimiter.ts",
      "server/src/readingsBuffer.ts",
    ],
    "The relay rules are pure, so tests need no sockets (relay.ts does I/O).",
    ["ws", "node:http", "node:net", "./relay", "./http"],
  ),
  boundary(
    ["packages/**/*.{ts,tsx}"],
    "Shared packages do not know the apps, the server or the sensor.",
    ["@app/monitor", "@app/control", "@app/server", "@app/sensor", "../../*"],
  ),
);

/** One import boundary: the files, why, and the imports they may not use. */
function boundary(files, message, group) {
  return {
    files,
    ignores: ["**/*.test.{ts,tsx}", "**/test/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [{ group, message, allowTypeImports: true }] },
      ],
    },
  };
}
