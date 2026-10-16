import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { workspaceTestAdminCredentials } from "@/shared/testing/workspace-test-environment";
import { resolveInstantNavigationAdminCredentials } from "../admin-basic-auth";
import {
  enablePreviewAccess,
  requireBaseUrl,
  reviewScreenshots,
} from "./navigation-test-helpers";

const remoteBaseUrl = process.env.WORKSPACE_E2E_BASE_URL;
// Fail closed at collection time when a remote preview is targeted without the
// runner-owned admin Basic auth pair; local runs keep the synthetic pair.
const adminCredentials = resolveInstantNavigationAdminCredentials({
  adminBasicAuthPair: process.env.WORKSPACE_E2E_ADMIN_BASIC_AUTH,
  localCredentials: workspaceTestAdminCredentials,
  remoteBaseUrl: remoteBaseUrl !== undefined,
});

test.use({
  httpCredentials: {
    ...adminCredentials,
    ...(remoteBaseUrl === undefined
      ? {}
      : { origin: new URL(remoteBaseUrl).origin }),
    send: "always",
  },
});

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
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
