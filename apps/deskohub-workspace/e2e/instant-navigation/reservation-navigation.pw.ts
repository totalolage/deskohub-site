import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  enablePreviewAccess,
  hasLoadedResource,
  requireBaseUrl,
} from "./navigation-test-helpers";

const reservationStepsName = "Reservation steps";

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

      // The route announcer mounts once the App Router has hydrated; the
      // SSR reservation link is replaced by the hydrated re-render. The
      // replacement can land after the SSR link first reports visible, so
      // each retry attempt re-resolves the link and redoes the side-effect-
      // free preparation; detachment inside an attempt fails that attempt
      // and a fresh attempt re-resolves the hydrated link.
      await page.locator("next-route-announcer").waitFor({ state: "attached" });
      let reservationLink = page
        .getByRole("link", { name: navigation.linkName })
        .first();
      await expect(async () => {
        // Re-resolve on every attempt: the hydrated re-render can detach the
        // SSR link mid-preparation, failing that attempt so the next one
        // binds to the replacement link.
        reservationLink = page
          .getByRole("link", { name: navigation.linkName })
          .first();
        await expect(reservationLink).toBeVisible();
        await reservationLink.scrollIntoViewIfNeeded();
        await reservationLink.hover();
      }).toPass({ timeout: workspaceE2ETimeouts.browserAction });
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
