import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["**/*.{js,mjs}"] },
  {
    files: ["**/*.{ts,tsx}"],
    ...reactHooks.configs.flat["recommended-latest"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.test-utils.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run[A-Z]/]",
          message:
            "Declare the real lifecycle boundary through WorkspaceEffect so logging, cancellation, and telemetry policy are applied.",
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "shared/backend/effect-boundary/next.ts",
      "**/*.test.{ts,tsx}",
      "**/*.test-utils.{ts,tsx}",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@deskohub/next-effect",
              message:
                "Workspace production code imports the app-owned WorkspaceEffect facade.",
            },
            {
              name: "@deskohub/next-effect/effect-action",
              message:
                "Workspace actions are declared through WorkspaceEffect.action.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "scripts/**",
      "shared/backend/effect-boundary/**",
      "**/*.test.{ts,tsx}",
      "**/*.test-utils.{ts,tsx}",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run[A-Z]/]",
          message:
            "Declare the real lifecycle boundary through WorkspaceEffect so logging, cancellation, and telemetry policy are applied.",
        },
        {
          selector:
            "CallExpression[callee.object.name='WorkspaceEffect'][callee.property.name='run']",
          message:
            "Use the named WorkspaceEffect lifecycle adapter; run is reserved for standalone scripts and boundary composition.",
        },
      ],
    },
  },
];
