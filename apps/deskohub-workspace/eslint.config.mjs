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
      "shared/backend/effect-boundary/executor.ts",
      "shared/backend/logging/censorship.ts",
      "shared/backend/logging/censorship-core.ts",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.object.name='Effect'][callee.property.name=/^run[A-Z]/]",
          message:
            "Run Effects through runWorkspaceEffect so Workspace logging and censorship layers are applied.",
        },
      ],
    },
  },
];
