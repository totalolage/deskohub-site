import { removeAccessibilityAccount } from "./account-session";
import { seededAccountSkipReason } from "./audit-target";
import { accessibilityTest as test } from "./fixtures";

test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);

// Teardown of the account session setup: Playwright runs it after every audit
// project, passed or failed.
test("remove the accessibility audit account", async ({ seededAccounts }) => {
  await removeAccessibilityAccount(seededAccounts);
});
