import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

const recommendedReactHooks = reactHooks.configs.flat["recommended-latest"];

export default [
  { ignores: ["**/*.{js,mjs}"] },
  {
    linterOptions: { reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["**/*.{ts,tsx}"],
    ...recommendedReactHooks,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...recommendedReactHooks.rules,
      // The lint task does not pass --max-warnings, so a warning never fails
      // CI. Keep the passing warn-level recommendations fail-closed.
      // incompatible-library stays a warning: it reports known third-party
      // hooks the React Compiler skips, which is not a code defect.
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/unsupported-syntax": "error",
    },
  },
];
