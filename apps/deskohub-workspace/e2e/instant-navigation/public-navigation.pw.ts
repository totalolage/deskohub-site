import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import {
  enablePreviewAccess,
  expectPublicSiteShell,
  hasLoadedResource,
} from "./navigation-test-helpers";

const galleryPath = "/en-US/gallery";
const contactPath = "/en-US/contact";
const homePath = "/en-US";

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("serves the resolved header and gallery on direct navigation", async ({
  page,
}) => {
  await page.goto(galleryPath);

  await expectPublicSiteShell(page);
  await expect(
    page.getByRole("heading", { level: 1, name: "Workspace gallery" })
  ).toBeVisible();
  await expectGalleryContentToResolve(page);
});

test("serves the resolved header and contact page on direct navigation", async ({
  page,
}) => {
  await page.goto(contactPath);

  await expectPublicSiteShell(page);
  await expectContactPage(page);
});

const clientNavigationCases = [
  {
    destinationPath: galleryPath,
    expectDestination: expectGalleryShell,
    expectResolved: expectGalleryContentToResolve,
    linkName: "Photos",
  },
  {
    destinationPath: contactPath,
    expectDestination: expectContactPage,
    linkName: "Contact",
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

  test("uses the prefetched homepage shell for section navigation", async ({
    page,
  }) => {
    await page.goto(galleryPath);

    const locationLink = page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Location" });
    await locationLink.hover();
    await expect.poll(() => hasLoadedResource(page, homePath)).toBe(true);
    await page.evaluate((path) => {
      document.documentElement.dataset.navigationSource = path;
    }, galleryPath);

    await instant(page, async () => {
      await locationLink.click();

      await expect(page).toHaveURL(/\/en-US#location-map$/);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.dataset.navigationSource
          )
        )
        .toBe(galleryPath);
      await expectPublicSiteShell(page);
      await expectHomeShell(page);
    });

    await expect(
      page.getByRole("region", { name: homeHeading })
    ).not.toHaveAttribute("aria-busy", "true");
    await expect(
      page.locator(`[aria-label="${carouselName}"][aria-busy="true"]`)
    ).toHaveCount(0);
  });
});

const homeHeading = "The first self-service workspace on Palmovka.";
const carouselName = "Deskohub workspace photo carousel";

async function expectHomeShell(page: Page) {
  await expect(
    page.getByRole("heading", { level: 1, name: homeHeading })
  ).toBeVisible();
  await expect(page.getByRole("region", { name: homeHeading })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Reserve cowork" })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 2,
      name: "Two minutes from Palmovka metro",
    })
  ).toBeVisible();
  await expect(page.locator("#hero-gallery")).toBeVisible();
}

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
