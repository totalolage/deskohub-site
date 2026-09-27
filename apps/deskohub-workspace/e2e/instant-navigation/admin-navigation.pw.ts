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

  await expect(page.getByRole("link", { name: "Export CSV" })).toBeVisible();

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

  await page.locator("nextjs-portal").evaluateAll((portals) => {
    for (const portal of portals) {
      (portal as HTMLElement).style.display = "none";
    }
  });

  const screenshotPath =
    "e2e-artifacts/reservation-links/admin-reservations-export.png";
  await page.screenshot({ fullPage: true, path: screenshotPath });
  await testInfo.attach("admin-reservations-export", {
    contentType: "image/png",
    path: screenshotPath,
  });
});
