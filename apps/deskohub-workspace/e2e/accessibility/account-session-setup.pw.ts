import { seedAccessibilityAccount } from "./account-session";
import { seededAccountSkipReason } from "./audit-target";
import { accessibilityTest as test } from "./fixtures";

test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);

test("seed the accessibility audit account", async ({ seededAccounts }) => {
  await seedAccessibilityAccount(seededAccounts);
});
