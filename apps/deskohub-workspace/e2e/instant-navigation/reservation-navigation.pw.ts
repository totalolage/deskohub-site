import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";

const reservationStepsName = "Reservation steps";

test.beforeEach(async ({ baseURL, context }) => {
  const previewBypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!previewBypassSecret) return;

  const response = await context.request.get(
    new URL("/favicon.svg", requireBaseUrl(baseURL)).toString(),
    {
      headers: {
        "x-vercel-protection-bypass": previewBypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
    }
  );
  expect(response.ok()).toBe(true);
  await response.dispose();
});

const directNavigationCases = [
  {
    contentName: "Reservation date",
    path: "/en-US/reservation/cowork",
    shellName: "Shape the day in one form.",
  },
  {
    contentName: "Meeting room start date",
    path: "/en-US/reservation/meeting-room",
    shellName: "Reserve the meeting room.",
  },
] as const;

for (const { contentName, path, shellName } of directNavigationCases) {
  test(`serves the ${path} shell on direct navigation`, async ({
    baseURL,
    page,
  }) => {
    await instant(
      page,
      async () => {
        await page.goto(path);

        await expectReservationSteps(page);
        await expect(
          page.getByRole("region", { name: shellName })
        ).toHaveAttribute("aria-busy", "true");
        await expect(page.getByLabel(contentName)).toHaveCount(0);
      },
      { baseURL: requireBaseUrl(baseURL) }
    );

    await expect(page.getByLabel(contentName)).toBeVisible();
  });
}

test("serves the reservation status shell on direct navigation", async ({
  baseURL,
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto(
        "/en-US/reservation/status/instant-navigation-missing-order"
      );

      await expectReservationSteps(page);
      await expect(
        page.getByRole("status", {
          name: "Payment status | Deskohub Workspace",
        })
      ).toHaveAttribute("aria-busy", "true");
      await page.close();
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
});

const clientNavigationCases = [
  {
    contentName: "Reservation date",
    destinationPath: "/en-US/reservation/cowork",
    linkName: "Reserve cowork",
    shellName: "Shape the day in one form.",
    sourcePath: "/en-US",
  },
  {
    contentName: "Meeting room start date",
    destinationPath: "/en-US/reservation/meeting-room",
    linkName: "Reserve",
    shellName: "Reserve the meeting room.",
    sourcePath: "/en-US/ttrpg-room",
  },
] as const;

test.describe("client navigation", () => {
  test.skip(
    process.env.WORKSPACE_E2E_BASE_URL === undefined,
    "Next.js link prefetching is disabled in development"
  );

  for (const navigation of clientNavigationCases) {
    test(`uses the prefetched ${navigation.destinationPath} shell for client navigation`, async ({
      page,
    }) => {
      await page.goto(navigation.sourcePath);

      const reservationLink = page
        .getByRole("link", { name: navigation.linkName })
        .first();
      await reservationLink.scrollIntoViewIfNeeded();
      await reservationLink.hover();
      await expect
        .poll(() => hasLoadedResource(page, navigation.destinationPath))
        .toBe(true);
      await page.evaluate((sourcePath) => {
        document.documentElement.dataset.navigationSource = sourcePath;
      }, navigation.sourcePath);

      await instant(page, async () => {
        await reservationLink.click();

        await expect(page).toHaveURL(
          new RegExp(`${navigation.destinationPath}$`)
        );
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.dataset.navigationSource
            )
          )
          .toBe(navigation.sourcePath);
        await expectReservationSteps(page);
        await expect(
          page.getByRole("region", { name: navigation.shellName })
        ).toHaveAttribute("aria-busy", "true");
        await expect(page.getByLabel(navigation.contentName)).toHaveCount(0);
      });

      await expect(page.getByLabel(navigation.contentName)).toBeVisible();
    });
  }
});

async function expectReservationSteps(page: Page) {
  await expect(
    page.getByRole("list", { name: reservationStepsName })
  ).toBeVisible();
}

async function hasLoadedResource(page: Page, pathname: string) {
  return page.evaluate((targetPathname) => {
    return performance.getEntriesByType("resource").some((entry) => {
      return new URL(entry.name, document.baseURI).pathname === targetPathname;
    });
  }, pathname);
}

function requireBaseUrl(baseURL: string | undefined) {
  if (!baseURL) {
    throw new Error("Playwright baseURL is required for instant navigation");
  }

  return baseURL;
}
