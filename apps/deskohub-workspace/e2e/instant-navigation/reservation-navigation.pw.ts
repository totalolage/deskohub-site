import { instant } from "@next/playwright";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { isNotFoundPage } from "../not-found-page";
import { enablePreviewAccess } from "../preview-access";
import { hasLoadedResource, requireBaseUrl } from "./navigation-test-helpers";

const reservationStepsName = "Reservation steps";
// The date field's calendar button carries the date label in every family;
// the text field takes the form's visible label, which varies by duration.
const calendarButtonName = (dateLabel: string) =>
  `${dateLabel}: choose from the calendar`;

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
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
  {
    contentName: "Office reservation start date",
    path: "/en-US/reservation/office",
    releaseMarker: "data-office-base-price",
    shellName: "Reserve a private office.",
  },
] as const;

for (const navigation of directNavigationCases) {
  const { contentName, path, shellName } = navigation;
  test(`serves the ${path} shell on direct navigation`, async ({
    baseURL,
    context,
    page,
  }) => {
    test.skip(
      "releaseMarker" in navigation &&
        !(await isReservationPageReleased(
          context,
          new URL(path, requireBaseUrl(baseURL)).toString(),
          navigation.releaseMarker
        )),
      `${path} is not released on this deployment`
    );

    await instant(
      page,
      async () => {
        await page.goto(path);

        await expectReservationSteps(page);
        await expect(
          page.getByRole("region", { name: shellName })
        ).toHaveAttribute("aria-busy", "true");
        await expect(
          page.getByRole("button", { name: calendarButtonName(contentName) })
        ).toHaveCount(0);
      },
      { baseURL: requireBaseUrl(baseURL) }
    );

    await expect(
      page.getByRole("button", { name: calendarButtonName(contentName) })
    ).toBeVisible();
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

test("serves the reservation access shell on direct navigation", async ({
  baseURL,
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto(
        "/en-US/reservation/access/instant-navigation-missing-order"
      );

      await expectReservationSteps(page);
      await expect(
        page.getByRole("status", {
          name: "Reservation access | Deskohub Workspace",
        })
      ).toHaveAttribute("aria-busy", "true");
      await page.close();
    },
    { baseURL: requireBaseUrl(baseURL) }
  );
});

test("rejects an invalid reservation capability with a private 404", async ({
  baseURL,
  context,
}) => {
  const response = await context.request.get(
    new URL(
      "/en-US/reservation/access/instant-navigation-missing-order?accessToken=invalid",
      requireBaseUrl(baseURL)
    ).toString(),
    { maxRedirects: 0 }
  );

  try {
    expect(response.status()).toBe(404);
    const headers = response.headers();
    expect(headers["cache-control"]).toBe("private, no-store");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(Object.hasOwn(headers, "location")).toBe(false);
    expect(Object.hasOwn(headers, "set-cookie")).toBe(false);
    expect((await response.body()).byteLength).toBe(0);
  } finally {
    await response.dispose();
  }
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
        await expect(
          page.getByRole("button", {
            name: calendarButtonName(navigation.contentName),
          })
        ).toHaveCount(0);
      });

      await expect(
        page.getByRole("button", {
          name: calendarButtonName(navigation.contentName),
        })
      ).toBeVisible();
    });
  }
});

/**
 * Whether a release-gated page renders its form for this visitor. A disabled
 * gate answers 404 or streams the not-found boundary with a 200; any other
 * response fails the test rather than skipping its coverage.
 */
async function isReservationPageReleased(
  context: BrowserContext,
  url: string,
  releaseMarker: string
) {
  const response = await context.request.get(url);

  try {
    if (response.status() === 404) return false;
    expect(response.ok(), `${url} responded with ${response.status()}`).toBe(
      true
    );

    const body = await response.text();
    if (body.includes(releaseMarker)) return true;
    if (isNotFoundPage(body)) return false;
    throw new Error(
      `${url} rendered neither its release marker nor a not-found page`
    );
  } finally {
    await response.dispose();
  }
}

async function expectReservationSteps(page: Page) {
  await expect(
    page.getByRole("list", { name: reservationStepsName })
  ).toBeVisible();
}
