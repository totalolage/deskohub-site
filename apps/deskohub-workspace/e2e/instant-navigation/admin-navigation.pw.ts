import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { workspaceTestAdminCredentials } from "@/shared/testing/workspace-test-environment";
import { resolveInstantNavigationAdminCredentials } from "../admin-basic-auth";
import { enablePreviewAccess, requireBaseUrl } from "./navigation-test-helpers";

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
}, testInfo) => {
  await instant(
    page,
    async () => {
      await page.goto("/admin/reservations");

      await expect(
        page.getByRole("navigation", { name: "Administration" }).first()
      ).toBeVisible();
      await expect(page.getByLabel("Loading reservation count")).toBeVisible();
      await expect(page.getByLabel("Loading table filters")).toBeVisible();
      await expect(page.getByLabel("Loading reservations")).toBeVisible();

      const skeleton = page.locator('[data-slot="skeleton"]').first();
      await expect(skeleton).toBeVisible();
      expect(
        await skeleton.evaluate(
          (element) => getComputedStyle(element, "::after").animationName
        )
      ).toBe("skeleton-glimmer");

      await page.locator("nextjs-portal").evaluateAll((portals) => {
        for (const portal of portals) {
          (portal as HTMLElement).style.display = "none";
        }
      });
      const screenshotPath = "e2e-artifacts/admin-reservations-loading.png";
      await page.screenshot({ fullPage: true, path: screenshotPath });
      await testInfo.attach("admin-reservations-loading", {
        contentType: "image/png",
        path: screenshotPath,
      });
      await page.emulateMedia({ reducedMotion: "reduce" });
      expect(
        await skeleton.evaluate(
          (element) => getComputedStyle(element, "::after").display
        )
      ).toBe("none");
      await page.close();
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
});

test("captures the resolved reservations export view", async ({
  page,
}, testInfo) => {
  await page.goto("/admin/reservations");

  const toolbar = page.getByRole("region", {
    name: "reservation table controls",
  });
  const exportLink = toolbar.getByRole("link", { name: "Export CSV" });
  await expect(toolbar).toBeVisible();
  await expect(exportLink).toBeVisible();
  await expect(toolbar.locator("#reservation-status")).toBeVisible();
  await expect(toolbar.locator("#reservation-type")).toBeVisible();
  await expect(toolbar.locator("#reservation-date-from")).toBeVisible();
  await expect(toolbar.locator("#reservation-date-to")).toBeVisible();
  await expect(
    toolbar.getByRole("navigation", { name: "Reservation date shortcuts" })
  ).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Apply filters" })
  ).toBeVisible();

  const reservations = page.getByRole("table", { name: "Reservations" });
  const emptyState = page.getByText("No reservations match this view.", {
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await reservations.isVisible()) || (await emptyState.isVisible())
    )
    .toBe(true);

  // The table is inside an overflow wrapper within its outer responsive frame.
  const tableBoundary = reservations.locator("xpath=../..");
  const resultBoundary = (await reservations.isVisible())
    ? tableBoundary
    : emptyState;
  await expect(resultBoundary).toBeVisible();

  await page.locator("nextjs-portal").evaluateAll((portals) => {
    for (const portal of portals) {
      (portal as HTMLElement).style.display = "none";
    }
  });

  const viewportSize = page.viewportSize();
  const toolbarBounds = await toolbar.boundingBox();
  const exportBounds = await exportLink.boundingBox();
  const resultBounds = await resultBoundary.boundingBox();
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  if (
    viewportSize === null ||
    toolbarBounds === null ||
    exportBounds === null ||
    resultBounds === null
  ) {
    throw new Error("Could not determine safe reservations screenshot bounds");
  }

  const toolbarBottom = toolbarBounds.y + toolbarBounds.height;
  const exportBottom = exportBounds.y + exportBounds.height;
  const resultClearance = 8;
  const clipHeight = Math.floor(resultBounds.y - resultClearance);
  expect(exportBounds.y).toBeGreaterThanOrEqual(toolbarBounds.y);
  expect(exportBottom).toBeLessThanOrEqual(toolbarBottom);
  expect(resultBounds.y - clipHeight).toBeGreaterThanOrEqual(resultClearance);
  expect(clipHeight).toBeGreaterThan(toolbarBottom);
  expect(clipHeight).toBeLessThanOrEqual(viewportSize.height);

  const screenshotPath =
    "e2e-artifacts/reservation-links/admin-reservations-export.png";
  await page.screenshot({
    clip: { height: clipHeight, width: viewportSize.width, x: 0, y: 0 },
    path: screenshotPath,
  });
  await testInfo.attach("admin-reservations-export", {
    contentType: "image/png",
    path: screenshotPath,
  });
});

test("captures the customer activity section after hydration", async ({
  page,
}, testInfo) => {
  await page.goto("/admin");

  const customerActivity = page.getByRole("region", {
    name: "Customer activity",
  });
  await expect(customerActivity.getByText("Unique customers")).toBeVisible();
  await expect(customerActivity.getByText("New customers")).toBeVisible();

  const screenshotPath =
    "e2e-artifacts/account-review/admin-overview-customer-activity.png";
  await page.screenshot({ fullPage: true, path: screenshotPath });
  await testInfo.attach("admin-overview-customer-activity", {
    contentType: "image/png",
    path: screenshotPath,
  });
  await page.close();
});
