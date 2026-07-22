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
            "Use the matching Workspace Effect runner or boundary so logging, cancellation, and telemetry policy are applied.",
        },
      ],
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ignores: [
      "shared/backend/standalone-workspace-effect.ts",
      "shared/backend/workspace-action.ts",
      "shared/backend/workspace-effect.ts",
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
                "Workspace production code uses the app-owned Workspace Effect runners.",
            },
            {
              name: "@deskohub/next-effect/effect-action",
              message:
                "Workspace actions are declared through defineWorkspaceAction or defineWorkspaceStateAction.",
            },
          ],
        },
      ],
    },
  },
];
