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
    files: ["features/checkout/backend/analytics/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "ArrowFunctionExpression[body.type='CallExpression'][body.callee.type='MemberExpression'][body.callee.object.name='Effect'][body.callee.property.name='gen']",
          message:
            "Define Effect generator functions with Effect.fn instead of wrapping Effect.gen in an arrow function.",
        },
      ],
    },
  },
];
