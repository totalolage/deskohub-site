import { expect, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { enablePreviewAccess } from "../preview-access";
import { auditedLocales, expectAxeClean } from "./accessibility-audit";
import { seededAccountSkipReason } from "./audit-target";
import { withPayPage } from "./pay-page";

// Each case holds one real Dotypos sandbox reservation until its finalizer
// cancels it, so the cases run one at a time and only in the desktop project.
// Its snapshot files are curated like workspace-aria-snapshots.pw.ts's; the
// full capture also holds the signed pay state, which never gets committed.
test.describe.configure({ mode: "serial" });

test.beforeEach(async ({ baseURL, context }) => {
  test.skip(seededAccountSkipReason !== undefined, seededAccountSkipReason);
  await enablePreviewAccess(context, baseURL);
});

for (const locale of auditedLocales) {
  test(`${locale} Pay with the consent unticked`, async ({
    baseURL,
    context,
    page,
  }, testInfo) => {
    await withPayPage({ baseURL, context, locale, page }, async () => {
      const consent = page.locator("#checkout-pay-legal-consent");
      const pay = page.getByRole("button", {
        name: new RegExp(`^${m.checkoutPayOrderAndPayButton({}, { locale })}`),
      });
      await expect(consent).not.toBeChecked();
      await expect(pay).toBeDisabled();

      await expectAxeClean(page, testInfo);
      await expect(page.getByRole("main")).toMatchAriaSnapshot({
        name: `${locale}-pay.aria.yml`,
      });
    });
  });
}
