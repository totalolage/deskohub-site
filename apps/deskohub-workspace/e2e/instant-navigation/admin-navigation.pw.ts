import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { m } from "@/features/administration/i18n";
import { m as customerMessages } from "@/features/i18n";
import { enablePreviewAccess } from "../preview-access";
import {
  instantNavigationAdministratorSkipReason,
  signInInstantNavigationAdministrator,
} from "./administrator-session";
import { requireBaseUrl, reviewScreenshots } from "./navigation-test-helpers";
import { preparePublicLegalBrowser } from "./public-account-legal-assertions";

test.skip(
  instantNavigationAdministratorSkipReason !== undefined,
  instantNavigationAdministratorSkipReason
);

// Every test signs in as the administrator the setup project seeded, with its
// own short-lived session.
test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
  await signInInstantNavigationAdministrator(context, baseURL);
});

test("serves the administration shell and granular loading regions", async ({
  baseURL,
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto("/en-US/admin/reservations");

      await expect(
        page.getByRole("navigation", { name: "Administration" }).first()
      ).toBeVisible();
      await expect(
        page.getByLabel(
          m.administrationReservationListCountLoading({}, { locale: "en-US" })
        )
      ).toBeVisible();
      await expect(
        page.getByLabel(
          m.administrationLoadingTableFilters({}, { locale: "en-US" })
        )
      ).toBeVisible();
      await expect(
        page.getByLabel(
          m.administrationReservationListLoading({}, { locale: "en-US" })
        )
      ).toBeVisible();

      await expect(
        page.locator('[data-slot="skeleton"]').first()
      ).toBeVisible();
      await page.close();
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
});

test("hydrates the customer activity section", async ({ page }, testInfo) => {
  await page.goto("/en-US/admin");

  const customerActivity = page.getByRole("region", {
    name: m.administrationOverviewCustomerActivityTitle(
      {},
      { locale: "en-US" }
    ),
  });
  await expect(
    customerActivity.getByText(
      m.administrationOverviewUniqueCustomersLabel({}, { locale: "en-US" })
    )
  ).toBeVisible();
  await expect(
    customerActivity.getByText(
      m.administrationOverviewNewCustomersLabel({}, { locale: "en-US" })
    )
  ).toBeVisible();

  if (reviewScreenshots) {
    const screenshotPath =
      "e2e-artifacts/account-review/admin-overview-customer-activity.png";
    await page.screenshot({ fullPage: true, path: screenshotPath });
    await testInfo.attach("admin-overview-customer-activity", {
      contentType: "image/png",
      path: screenshotPath,
    });
  }
  await page.close();
});

test("hydrates the customer activity section in Czech", async ({ page }) => {
  await page.goto("/cs-CZ/admin");

  const customerActivity = page.getByRole("region", {
    name: m.administrationOverviewCustomerActivityTitle(
      {},
      { locale: "cs-CZ" }
    ),
  });
  await expect(
    customerActivity.getByText(
      m.administrationOverviewUniqueCustomersLabel({}, { locale: "cs-CZ" })
    )
  ).toBeVisible();

  await page.close();
});

test("renders an unknown administration address in the administration frame", async ({
  context,
  page,
}) => {
  // Lets the consent banner show if the customer providers render.
  await preparePublicLegalBrowser(context);
  await page.goto("/en-US/admin/route-fallback-unknown-address");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.shellNotFoundTitle({}, { locale: "en-US" }),
    })
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Administration" }).first()
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: customerMessages.notFoundTitle({}, { locale: "en-US" }),
    })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: customerMessages.cookieConsentConsentModalAcceptNecessaryBtn(
        {},
        { locale: "en-US" }
      ),
    })
  ).toHaveCount(0);
  await page.close();
});
