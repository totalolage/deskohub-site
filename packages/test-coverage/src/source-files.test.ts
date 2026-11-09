import { expect, test } from "bun:test";
import { isCoverageSource } from "./source-files";

test.each([
  ["apps/deskohub-workspace/features/checkout/pricing.ts", true],
  ["apps/deskohub-workspace/features/account/account-page.tsx", true],
  ["packages/dotypos/src/index.ts", true],
  ["scripts/generate-effect-openapi-client.ts", true],
  ["apps/deskohub-workspace/features/checkout/pricing.test.ts", false],
  ["apps/deskohub-workspace/e2e/account/sign-in.pw.ts", false],
  ["packages/nexi/src/client.spec.tsx", false],
  ["apps/deskohub-workspace/types/globals.d.ts", false],
  ["apps/deskohub-workspace/messages/cs-CZ.json", false],
  ["packages/test-coverage/src/coverage-report.ts", false],
  ["lint/no-useless-alias.grit", false],
])("isCoverageSource(%p) is %p", (path, expected) => {
  expect(isCoverageSource(path)).toBe(expected);
});
