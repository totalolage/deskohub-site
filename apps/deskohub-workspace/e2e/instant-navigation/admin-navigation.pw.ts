import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { workspaceTestAdminCredentials } from "@/shared/testing/workspace-test-environment";
import { requireBaseUrl } from "./navigation-test-helpers";

test.use({ httpCredentials: workspaceTestAdminCredentials });

test.skip(
  process.env.WORKSPACE_E2E_BASE_URL !== undefined,
  "Local Instant tests use synthetic administration credentials"
);

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
