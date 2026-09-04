import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

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
  ...tseslint.configs.strictTypeChecked,
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
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repositoryRoot,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/restrict-template-expressions": "off",
      "prefer-const": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      ...reactHooks.configs.recommended.rules,
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    files: ["client/src/**/*.{ts,tsx}", "server/**/*.ts"],
    rules: {
      "max-lines": [
        "error",
        { max: 350, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ["client/src/components/Workspace/SessionRail.tsx"],
    rules: { "react-hooks/incompatible-library": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: { "max-lines": "off", "max-lines-per-function": "off" },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,cjs,mjs}"],
  },
  eslintConfigPrettier,
];
