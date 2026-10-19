import { test } from "@playwright/test";
import { removeAccessibilityAccount } from "./account-session";
import { seededAccountSkipReason } from "./audit-target";

// Teardown of the account session setup: Playwright runs it after every audit
// project, passed or failed.
test("remove the accessibility audit account", async ({ baseURL }) => {
  test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);
  await removeAccessibilityAccount(baseURL);
});
