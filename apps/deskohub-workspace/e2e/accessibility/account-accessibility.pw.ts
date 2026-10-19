import { expect, test } from "@playwright/test";
import {
  getAccountPath,
  getAccountSectionPath,
} from "@/features/account/routes";
import {
  type AccountSection,
  accountSections,
  defaultAccountSection,
} from "@/features/account/sections";
import { accountSectionLandmarks } from "../account/account-sections";
import { enablePreviewAccess } from "../preview-access";
import {
  auditedLocales,
  expectAxeClean,
  openSettledPage,
} from "./accessibility-audit";
import { signInAccessibilityAccount } from "./account-session";
import { seededAccountSkipReason } from "./audit-target";

test.beforeEach(async ({ baseURL, context }) => {
  test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);
  await enablePreviewAccess(context, baseURL);
  await signInAccessibilityAccount(context, baseURL);
});

for (const locale of auditedLocales) {
  const pages: readonly {
    readonly name: string;
    readonly path: string;
    readonly section: AccountSection;
  }[] = [
    {
      name: "account",
      path: getAccountPath(locale),
      section: defaultAccountSection,
    },
    ...accountSections.map((section) => ({
      name: `account ${section}`,
      path: getAccountSectionPath(locale, section),
      section,
    })),
  ];
  for (const { name, path, section } of pages) {
    test(`${locale} ${name} has no detectable accessibility violations`, async ({
      page,
    }, testInfo) => {
      await openSettledPage(page, path);
      // A rejected session shows sign-in or an unavailable account instead.
      await expect(page).toHaveURL((url) => url.pathname === path);
      await expect(
        page.locator(accountSectionLandmarks[section]).first()
      ).toBeVisible();
      await expectAxeClean(page, testInfo);
    });
  }
}
