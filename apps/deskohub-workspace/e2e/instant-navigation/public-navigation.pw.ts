import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { enablePreviewAccess } from "../preview-access";
import {
  expectPublicSiteShell,
  hasLoadedResource,
} from "./navigation-test-helpers";

const galleryPath = "/en-US/gallery";
const contactPath = "/en-US/contact";
const homePath = "/en-US";
const ttrpgRoomPath = "/en-US/ttrpg-room";
const locale = "en-US" as const;

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test("serves the resolved homepage on direct navigation", async ({ page }) => {
  const response = await page.goto(homePath);
  if (!response) throw new Error("Homepage navigation returned no response");

  expect(response.ok()).toBe(true);
  expect(await response.text()).not.toContain('aria-busy="true"');
  await expectPublicSiteShell(page);
  await expectHomePage(page);
});

test("serves the resolved header and gallery on direct navigation", async ({
  page,
}) => {
  await page.goto(galleryPath);

  await expectPublicSiteShell(page);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.galleryPageTitle({}, { locale }),
    })
  ).toBeVisible();
  await expectGalleryContentToResolve(page);
});

test("serves the resolved header and TTRPG page on direct navigation", async ({
  page,
}) => {
  await page.goto(ttrpgRoomPath);

  await expectPublicSiteShell(page);
  await expectTtrpgRoomPage(page);
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
        .getByRole("navigation", { name: "Primary navigation" })
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

  test("uses the resolved prefetched homepage for section navigation", async ({
    page,
  }) => {
    await page.goto(galleryPath);

    const locationLink = page
      .getByRole("navigation", { name: "Primary navigation" })
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
          page.evaluate(() => document.documentElement.dataset.navigationSource)
        )
        .toBe(galleryPath);
      await expectPublicSiteShell(page);
      await expectHomePage(page);
    });
  });

  for (const navigation of [
    {
      destinationPath: homePath,
      expectDestination: expectHomePage,
      linkName: "Home",
    },
  ] as const) {
    test(`uses prefetched UI from the footer for ${navigation.destinationPath}`, async ({
      page,
    }) => {
      await page.goto(galleryPath);
      const sourceNavigation = await getPrimaryNavigationLinks(page);
      const destinationLink = page
        .getByRole("contentinfo")
        .getByRole("link", { name: navigation.linkName });
      await destinationLink.scrollIntoViewIfNeeded();
      await destinationLink.hover();
      await expect
        .poll(() => hasLoadedResource(page, navigation.destinationPath))
        .toBe(true);
      await page.evaluate((path) => {
        document.documentElement.dataset.navigationSource = path;
      }, galleryPath);

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
          .toBe(galleryPath);
        await expectPublicSiteShell(page);
        await navigation.expectDestination(page);
        expect(await getPrimaryNavigationLinks(page)).toEqual(sourceNavigation);
      });
    });
  }
});

async function expectHomePage(page: Page) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.landingHeroTitle({}, { locale }),
    })
  ).toBeVisible();
  // The decorative carousel may be absent when Cloudinary has no usable
  // images; when it renders, it must already be resolved.
  const carousel = page.locator("#hero-gallery");
  if ((await carousel.count()) > 0) await expect(carousel).toBeVisible();
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}

async function expectGalleryShell(page: Page) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.galleryPageTitle({}, { locale }),
    })
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: m.gallerySrTitle({}, { locale }) })
  ).toHaveAttribute("aria-busy", "true");
}

async function expectGalleryContentToResolve(page: Page) {
  await expect(
    page.getByRole("region", { name: m.gallerySrTitle({}, { locale }) })
  ).toHaveCount(0);
}

async function expectContactPage(page: Page) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.contactDetailsTitle({}, { locale }),
    })
  ).toBeVisible();
}

async function expectTtrpgRoomPage(page: Page) {
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.ttrpgRoomHeroTitle({}, { locale }),
    })
  ).toBeVisible();
}

async function getPrimaryNavigationLinks(page: Page) {
  return page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => {
        const href = new URL(
          link.getAttribute("href") ?? "",
          window.location.href
        );

        return {
          href: `${href.pathname}${href.hash}`,
          text: link.textContent?.trim() ?? "",
        };
      })
    );
}
