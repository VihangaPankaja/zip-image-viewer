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
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repositoryRoot,
      },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "error",
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
    rules: { "react-hooks/incompatible-library": "off" },
  },
  {
    files: ["**/*.test.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: { "max-lines-per-function": "off" },
  },
  {
    ...tseslint.configs.disableTypeChecked,
    files: ["**/*.{js,cjs,mjs}"],
  },
  eslintConfigPrettier,
];
