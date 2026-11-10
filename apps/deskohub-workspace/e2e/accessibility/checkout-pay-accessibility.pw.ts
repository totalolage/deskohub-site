import { expect } from "@playwright/test";
import { m } from "@/features/i18n";
import { enablePreviewAccess } from "../preview-access";
import {
  auditedLocales,
  expectAxeClean,
  hasAriaSnapshots,
} from "./accessibility-audit";
import { seededAccountSkipReason } from "./audit-target";
import { accessibilityTest as test } from "./fixtures";
import { withPayPage } from "./pay-page";

// Each case holds one real Dotypos sandbox reservation until its finalizer
// cancels it, so the cases run one at a time and only in the desktop project.
// Its snapshot files are curated like workspace-aria-snapshots.pw.ts's; the
// full capture also holds the signed pay state, which never gets committed.
// Every locale gets the axe audit; only curated locales match a snapshot.
test.describe.configure({ mode: "serial" });
test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

for (const locale of auditedLocales) {
  test(`${locale} Pay with the consent unticked`, async ({
    context,
    page,
    seededAccounts,
  }, testInfo) => {
    await withPayPage(
      { context, locale, page, runtime: seededAccounts },
      async () => {
        const consent = page.locator("#checkout-pay-legal-consent");
        const pay = page.getByRole("button", {
          name: new RegExp(
            `^${m.checkoutPayOrderAndPayButton({}, { locale })}`
          ),
        });
        await expect(consent).not.toBeChecked();
        await expect(pay).toBeDisabled();

        await expectAxeClean(page, testInfo);
        if (hasAriaSnapshots(locale)) {
          await expect(page.getByRole("main")).toMatchAriaSnapshot({
            name: `${locale}-pay.aria.yml`,
          });
        }
      }
    );
  });
}
