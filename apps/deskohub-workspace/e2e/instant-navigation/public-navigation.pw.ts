import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  enablePreviewAccess,
  expectPublicSiteShell,
  hasLoadedResource,
  requireBaseUrl,
} from "./navigation-test-helpers";

const galleryPath = "/en-US/gallery";
const contactPath = "/en-US/contact";

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("serves the gallery shell on direct navigation", async ({
  baseURL,
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto(galleryPath);

      await expectPublicSiteShell(page);
      await expectGalleryShell(page);
    },
    { baseURL: requireBaseUrl(baseURL) }
  );

  await expectGalleryContentToResolve(page);
});

test("serves the complete contact page on direct navigation", async ({
  baseURL,
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto(contactPath);

      await expectPublicSiteShell(page);
      await expectContactPage(page);
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
});

const clientNavigationCases = [
  {
    destinationPath: galleryPath,
    expectDestination: expectGalleryShell,
    expectResolved: expectGalleryContentToResolve,
    linkName: "Gallery",
  },
  {
    destinationPath: contactPath,
    expectDestination: expectContactPage,
    linkName: "Contact us",
  },
] as const;

test.describe("client navigation", () => {
  test.skip(
    process.env.WORKSPACE_E2E_BASE_URL === undefined,
    "Next.js link prefetching is disabled in development"
  );

  for (const navigation of clientNavigationCases) {
    test(`uses prefetched UI for ${navigation.destinationPath}`, async ({
      page,
    }) => {
      const sourcePath = "/en-US";
      await page.goto(sourcePath);

      const destinationLink = page
        .getByRole("navigation", { name: "Primary" })
        .getByRole("link", { name: navigation.linkName });
      await destinationLink.hover();
      await expect
        .poll(() => hasLoadedResource(page, navigation.destinationPath))
        .toBe(true);
      await page.evaluate((path) => {
        document.documentElement.dataset.navigationSource = path;
      }, sourcePath);

      await instant(page, async () => {
        await destinationLink.click();

        await expect(page).toHaveURL(
          new RegExp(`${navigation.destinationPath}$`)
        );
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.dataset.navigationSource
            )
          )
          .toBe(sourcePath);
        await expectPublicSiteShell(page);
        await navigation.expectDestination(page);
      });

      if ("expectResolved" in navigation) {
        await navigation.expectResolved(page);
      }
    });
  }
});

async function expectGalleryShell(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace gallery" })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Workspace gallery" })
  ).toHaveAttribute("aria-busy", "true");
}

async function expectGalleryContentToResolve(page: Page) {
  await expect(
    page.getByRole("region", { name: "Workspace gallery" })
  ).toHaveCount(0);
}

async function expectContactPage(page: Page) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Tell us what kind of day you want to build.",
    })
  ).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Email" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message" })).toBeVisible();
}
