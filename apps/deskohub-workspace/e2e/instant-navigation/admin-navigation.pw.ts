import type { DotyposCustomerId } from "@deskohub/dotypos";
import { instant } from "@next/playwright";
import { expect, test } from "@playwright/test";
import { m } from "@/features/administration/i18n";
import { m as customerMessages } from "@/features/i18n";
import { makeWorkspaceE2EAccountRecipientForRunId } from "../account/config";
import {
  createSyntheticCustomerProfile,
  expireSyntheticCustomerProfile,
} from "../account/fixtures";
import { resolveWorkspaceE2ERunContext } from "../playwright-checkout/run-context";
import { enablePreviewAccess } from "../preview-access";
import { addRedaction } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  instantNavigationAdministratorSkipReason,
  makeInstantNavigationAdministratorRuntime,
  signInInstantNavigationAdministrator,
} from "./administrator-session";
import { requireBaseUrl, reviewScreenshots } from "./navigation-test-helpers";
import { preparePublicLegalBrowser } from "./public-account-legal-assertions";

test.skip(
  instantNavigationAdministratorSkipReason !== undefined,
  instantNavigationAdministratorSkipReason
);

// Every test signs in as the administrator the setup project seeded, with its
// own short-lived session.
test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
  await signInInstantNavigationAdministrator(context, baseURL);
});

test("serves the administration shell and granular loading regions", async ({
  baseURL,
  page,
}) => {
  await instant(
    page,
    async () => {
      await page.goto("/en-US/admin/reservations");

      await expect(
        page.getByRole("navigation", { name: "Administration" }).first()
      ).toBeVisible();
      await expect(
        page.getByLabel(
          m.administrationReservationListCountLoading({}, { locale: "en-US" })
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
  );
});

test("hydrates the customer activity section", async ({ page }, testInfo) => {
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
});

test("hydrates the customer activity section in Czech", async ({
  page,
}, testInfo) => {
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
});

test("captures the customer reservation activity calendar", async ({
  page,
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

    if (reviewScreenshots) {
      await page.setViewportSize({ height: 1212, width: 1896 });
    }
    await page.goto(
      `/cs-CZ/admin/customers/${encodeURIComponent(customerId)}`,
      { waitUntil: "commit" }
    );
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
  } catch {
    failure = new Error(
      "Could not capture the synthetic customer reservation activity calendar"
    );
  } finally {
    // Failure diagnostics must not retain the synthetic customer's ID or
    // render real customer names. Leave the page blank before the test fails.
    const blankPageLoaded = await page
      .goto("about:blank", { timeout: 5_000, waitUntil: "commit" })
      .then(
        () => true,
        () => false
      );
    if (!blankPageLoaded) await page.close().catch(() => undefined);
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
  context,
  page,
}) => {
  // Lets the consent banner show if the customer providers render.
  await preparePublicLegalBrowser(context);
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
});
