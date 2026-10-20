import { test } from "@playwright/test";
import { seedAccessibilityAccount } from "./account-session";
import { seededAccountSkipReason } from "./audit-target";

test("seed the accessibility audit account", async ({ baseURL }) => {
  test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);
  await seedAccessibilityAccount(baseURL);
});
