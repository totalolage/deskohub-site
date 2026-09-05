import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  enablePreviewAccess,
  expectPublicSiteShell,
  hasLoadedResource,
  requireBaseUrl,
} from "./navigation-test-helpers";

const homePath = "/en-US";
const accountPath = "/en-US/account";
const signInPath = "/en-US/auth/sign-in";
const accountStatusName = "My account | Deskohub Workspace";
const signInHeading = "Sign in or create an account";

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test.describe("client navigation", () => {
  test.skip(
    process.env.WORKSPACE_E2E_BASE_URL === undefined,
    "Next.js link prefetching is disabled in development"
  );

  test("streams the account loading shell before redirecting an anonymous client", async ({
    baseURL,
    page,
  }) => {
    await page.goto(homePath);
    await expectPublicSiteShell(page);

    await navigateToAccount(page, baseURL);
    await expectAnonymousSignIn(page);

    await page.getByRole("link", { name: "Deskohub Workspace" }).click();
    await expect(page).toHaveURL(new RegExp(`${homePath}$`));
    await expectPublicSiteShell(page);

    await navigateToAccount(page, baseURL);
    await expectAnonymousSignIn(page);
  });
});

async function navigateToAccount(page: Page, baseURL: string | undefined) {
  const accountLink = page
    .getByRole("banner")
    .getByRole("link", { name: "Account" });

  await expect(accountLink).toBeVisible();
  await accountLink.hover();
  await expect.poll(() => hasLoadedResource(page, accountPath)).toBe(true);
  await page.evaluate((path) => {
    document.documentElement.dataset.navigationSource = path;
  }, homePath);

  await instant(
    page,
    async () => {
      await accountLink.click();

      await expect(page).toHaveURL(new RegExp(`${accountPath}$`));
      await expect
        .poll(() =>
          page.evaluate(() => document.documentElement.dataset.navigationSource)
        )
        .toBe(homePath);
      await expectPublicSiteShell(page);
      const status = page.getByRole("status", { name: accountStatusName });
      await expect(status).toBeVisible();
      await expect(status).toHaveAttribute("aria-busy", "true");
      await expect(
        status.locator('[data-slot="skeleton"]').first()
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: signInHeading })
      ).toHaveCount(0);
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
}

async function expectAnonymousSignIn(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${signInPath}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: signInHeading })
  ).toBeVisible();
}
