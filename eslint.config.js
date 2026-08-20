import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  {
    ignores: [
      "coverage/**",
      "dist/**",
      "build/**",
      ".vite-cache/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: [
      "*.config.ts",
      "client/src/**/*.{ts,tsx}",
      "server/**/*.ts",
      "shared/**/*.ts",
      "tests/**/*.ts",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const": "off",
      // TypeScript-aware unused analysis understands callback signatures and
      // type-only declarations; the core rule reports false positives there.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      ...reactHooks.configs.recommended.rules,
      // The existing data-loading hooks intentionally synchronize external
      // resources into React state. Keep this off until those hooks move to
      // TanStack Query in the workspace refactor.
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}", "server/**/*.ts"],
    rules: {
      "max-lines": [
        "warn",
        { max: 350, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "warn",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["server/runtimeComposition.ts"],
    rules: {
      "max-lines": "warn",
      "max-lines-per-function": "warn",
    },
  },
  {
    files: ["client/src/components/Workspace/SessionRail.tsx"],
    rules: {
      // TanStack Virtual intentionally returns imperative methods that React
      // Compiler cannot memoize; the component keeps them local and unmemoized.
      "react-hooks/incompatible-library": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      // Test suites group related cases in describe callbacks; production
      // source retains the strict 80-line function limit.
      "max-lines-per-function": "off",
    },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,cjs,mjs}"],
  },
  eslintConfigPrettier,
];
