import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import {
  instantNavigationAdministratorSkipReason,
  signInInstantNavigationAdministrator,
} from "./administrator-session";
import {
  enablePreviewAccess,
  requireBaseUrl,
  reviewScreenshots,
} from "./navigation-test-helpers";

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
      await expect(page.getByLabel("Loading reservation count")).toBeVisible();
      await expect(page.getByLabel("Loading table filters")).toBeVisible();
      await expect(page.getByLabel("Loading reservations")).toBeVisible();

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
    name: "Customer activity",
  });
  await expect(customerActivity.getByText("Unique customers")).toBeVisible();
  await expect(customerActivity.getByText("New customers")).toBeVisible();

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
