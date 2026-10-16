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
);
