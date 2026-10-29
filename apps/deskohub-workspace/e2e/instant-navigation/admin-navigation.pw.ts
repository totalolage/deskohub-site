import type { DotyposCustomerId } from "@deskohub/dotypos";
import { instant } from "@next/playwright";
import { test as base, expect, type Page } from "@playwright/test";
import { Effect } from "effect";
import { m } from "@/features/administration/i18n";
import { m as customerMessages } from "@/features/i18n";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import {
  createSyntheticCustomerProfile,
  expireSyntheticCustomerProfile,
} from "../account/fixtures";
import type { E2EBrowserSession } from "../browser-session";
import { runUntracedE2EEffect } from "../effect-edge";
import { resolveWorkspaceE2ERunContext } from "../playwright-checkout/run-context";
import { addRedaction } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  instantNavigationAdministratorSkipReason,
  makeInstantNavigationAdministratorRuntime,
  withInstantNavigationAdministratorSession,
} from "./administrator-session";
import { requireBaseUrl, reviewScreenshots } from "./navigation-test-helpers";
import { preparePublicLegalBrowser } from "./public-account-legal-assertions";

// Every test drives its own browser session, signed in as the administrator
// the setup project seeded with its own short-lived session.
const test = base.extend<{ administrator: E2EBrowserSession }>({
  administrator: async ({ baseURL, browser }, use) =>
    withInstantNavigationAdministratorSession({ baseURL, browser }, use),
});

test.skip(
  instantNavigationAdministratorSkipReason !== undefined,
  instantNavigationAdministratorSkipReason
);

const drive = (
  session: E2EBrowserSession,
  label: string,
  run: (page: Page) => Promise<void>
) => runUntracedE2EEffect(session.use(label, run));

test("serves the administration shell and granular loading regions", async ({
  administrator,
  baseURL,
}) => {
  await drive(
    administrator,
    "serve the administration shell and its loading regions",
    (page) =>
      instant(
        page,
        async () => {
          await page.goto("/en-US/admin/reservations");

          await expect(
            page.getByRole("navigation", { name: "Administration" }).first()
          ).toBeVisible();
          await expect(
            page.getByLabel(
              m.administrationReservationListCountLoading(
                {},
                { locale: "en-US" }
              )
            )
          ).toBeVisible();
          await expect(
            page.getByLabel(
              m.administrationLoadingTableFilters({}, { locale: "en-US" })
            )
          ).toBeVisible();
          await expect(
            page.getByLabel(
              m.administrationReservationListLoading({}, { locale: "en-US" })
            )
          ).toBeVisible();

          await expect(
            page.locator('[data-slot="skeleton"]').first()
          ).toBeVisible();
          await page.close();
        },
        { baseURL: requireBaseUrl(baseURL) }
      )
  );
});

test("hydrates the customer activity section", async ({
  administrator,
}, testInfo) => {
  await drive(
    administrator,
    "hydrate the customer activity section",
    async (page) => {
      // Review captures match the viewport of the Vercel comment they answer.
      if (reviewScreenshots) {
        await page.setViewportSize({ height: 1212, width: 1896 });
      }
      await page.goto("/en-US/admin");

      const customerActivity = page.getByRole("region", {
        name: m.administrationOverviewCustomerActivityTitle(
          {},
          { locale: "en-US" }
        ),
      });
      await expect(
        customerActivity.getByText(
          m.administrationOverviewUniqueCustomersLabel({}, { locale: "en-US" })
        )
      ).toBeVisible();
      await expect(
        customerActivity.getByText(
          m.administrationOverviewNewCustomersLabel({}, { locale: "en-US" })
        )
      ).toBeVisible();

      if (reviewScreenshots) {
        // The reservation activity calendar streams separately; wait for the
        // rendered calendar so the screenshot shows its weekday layout and cells.
        await expect(
          page
            .getByRole("region", {
              name: m.administrationReservationActivityCalendarLabel(
                {},
                { locale: "en-US" }
              ),
            })
            .first()
        ).toBeVisible();
        const screenshotPath =
          "e2e-artifacts/account-review/admin-overview-customer-activity.png";
        await page.screenshot({
          fullPage: true,
          mask: [page.locator('a[href*="/admin/customers/"]')],
          path: screenshotPath,
        });
        await testInfo.attach("admin-overview-customer-activity", {
          contentType: "image/png",
          path: screenshotPath,
        });
      }
      await page.close();
    }
  );
});

test("hydrates the customer activity section in Czech", async ({
  administrator,
}, testInfo) => {
  await drive(
    administrator,
    "hydrate the Czech customer activity section",
    async (page) => {
      if (reviewScreenshots) {
        await page.setViewportSize({ height: 1212, width: 1896 });
      }
      await page.goto("/cs-CZ/admin");

      const customerActivity = page.getByRole("region", {
        name: m.administrationOverviewCustomerActivityTitle(
          {},
          { locale: "cs-CZ" }
        ),
      });
      await expect(
        customerActivity.getByText(
          m.administrationOverviewUniqueCustomersLabel({}, { locale: "cs-CZ" })
        )
      ).toBeVisible();

      if (reviewScreenshots) {
        await expect(
          page.getByRole("region", {
            name: m.administrationReservationActivityCalendarLabel(
              {},
              { locale: "cs-CZ" }
            ),
          })
        ).toBeVisible();
        const screenshotPath =
          "e2e-artifacts/account-review/admin-overview-reservation-activity-cs.png";
        await page.screenshot({
          fullPage: true,
          mask: [page.locator('a[href*="/admin/customers/"]')],
          path: screenshotPath,
        });
        await testInfo.attach("admin-overview-reservation-activity-cs", {
          contentType: "image/png",
          path: screenshotPath,
        });
      }

      await page.close();
    }
  );
});

test("captures the customer reservation activity calendar", async ({
  administrator,
}, testInfo) => {
  test.skip(!reviewScreenshots, "Review screenshot capture is opt-in");
  test.setTimeout(workspaceE2ETimeouts.reviewScreenshotCapture);

  const { datasourceConfig, environment, runPromise } =
    makeInstantNavigationAdministratorRuntime();
  const { runId } = resolveWorkspaceE2ERunContext(environment);
  const recipient = makeWorkspaceE2EAccountRecipientForRunId(
    runId,
    "nav-activity-customer"
  );
  let customerId: DotyposCustomerId | undefined;
  let failure: Error | undefined;

  try {
    customerId = await runPromise(
      createSyntheticCustomerProfile(datasourceConfig, {
        email: recipient,
        firstName: "Workspace",
      })
    );
    addRedaction(customerId);
    const customerPath = `/cs-CZ/admin/customers/${encodeURIComponent(customerId)}`;

    await drive(
      administrator,
      "capture the customer reservation activity calendar",
      async (page) => {
        if (reviewScreenshots) {
          await page.setViewportSize({ height: 1212, width: 1896 });
        }
        await page.goto(customerPath, { waitUntil: "commit" });
        await expect(
          page.getByRole("region", {
            name: m.administrationReservationActivityCalendarLabel(
              {},
              { locale: "cs-CZ" }
            ),
          })
        ).toBeVisible();

        const screenshotPath =
          "e2e-artifacts/account-review/admin-customer-reservation-activity-cs.png";
        await page.screenshot({ fullPage: true, path: screenshotPath });
        await testInfo.attach("admin-customer-reservation-activity-cs", {
          contentType: "image/png",
          path: screenshotPath,
        });
      }
    );
  } catch {
    failure = new Error(
      "Could not capture the synthetic customer reservation activity calendar"
    );
  } finally {
    // Failure diagnostics must not retain the synthetic customer's ID or
    // render real customer names. Leave the page blank before the test fails.
    await runUntracedE2EEffect(
      administrator
        .use("leave the customer page blank", (page) =>
          page.goto("about:blank", { timeout: 5_000, waitUntil: "commit" })
        )
        .pipe(
          Effect.catch(() =>
            administrator.use("close the customer page", (page) => page.close())
          ),
          Effect.ignore
        )
    );
    if (customerId !== undefined) {
      try {
        await runPromise(
          expireSyntheticCustomerProfile(datasourceConfig, customerId)
        );
      } catch {
        failure = new Error(
          "Could not expire the synthetic review customer profile"
        );
      }
    }
  }

  if (failure) throw failure;
});

test("renders an unknown administration address in the administration frame", async ({
  administrator,
}) => {
  await drive(
    administrator,
    "render an unknown administration address",
    async (page) => {
      // Lets the consent banner show if the customer providers render.
      await preparePublicLegalBrowser(page.context());
      await page.goto("/en-US/admin/route-fallback-unknown-address");

      await expect(
        page.getByRole("heading", {
          level: 1,
          name: m.shellNotFoundTitle({}, { locale: "en-US" }),
        })
      ).toBeVisible();
      await expect(
        page.getByRole("navigation", { name: "Administration" }).first()
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: customerMessages.notFoundTitle({}, { locale: "en-US" }),
        })
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", {
          name: customerMessages.cookieConsentConsentModalAcceptNecessaryBtn(
            {},
            { locale: "en-US" }
          ),
        })
      ).toHaveCount(0);
      await page.close();
    }
  );
});
