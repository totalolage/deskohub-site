import { expect, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { captureAccountReview } from "../account/review-screenshots";
import { dismissLegalCookieConsent } from "../legal-cookie-consent";
import { workspaceE2ETimeouts } from "../timeouts";
import { enablePreviewAccess, requireBaseUrl } from "./navigation-test-helpers";
import {
  type CookieCategory,
  expectNoAuthSessionCookie,
  expectPublicAccountLegal,
  preparePublicLegalBrowser,
  waitForCookieSwitchHandler,
} from "./public-account-legal-assertions";

const locale = "en-US" as const;
const publicAccountLegalPath = `/${locale}/account/legal`;
const legacyCookieSettingsPath = `/${locale}/cookie-settings`;
const viewports = [
  { height: 1_000, name: "desktop", width: 1_440 },
  { height: 900, name: "mobile 375", width: 375 },
] as const;
const publicLegalReviewTargetByViewport = {
  desktop: "public-legal-desktop",
  "mobile 375": "public-legal-mobile",
} as const;
const cookieCategoryTitles = {
  necessary: m.cookieSettingsNecessaryTitle({}, { locale }),
  analytics: m.cookieSettingsAnalyticsTitle({}, { locale }),
  marketing: m.cookieSettingsMarketingTitle({}, { locale }),
  preferences: m.cookieSettingsPreferencesTitle({}, { locale }),
} as const;

test.beforeEach(async ({ baseURL, context }) => {
  await preparePublicLegalBrowser(context);
  await enablePreviewAccess(context, baseURL);
});

for (const viewport of viewports) {
  test(`renders anonymous public account legal at ${viewport.name}`, async ({
    baseURL,
    context,
    page,
  }) => {
    await expectNoAuthSessionCookie(context);
    await page.setViewportSize(viewport);
    await page.goto(publicAccountLegalPath, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    await expect(page).toHaveURL(
      new URL(publicAccountLegalPath, requireBaseUrl(baseURL)).toString()
    );

    await dismissLegalCookieConsent(page, locale);
    await expectPublicAccountLegal(page);
    await captureAccountReview(
      page,
      requireBaseUrl(baseURL),
      publicLegalReviewTargetByViewport[viewport.name]
    );
  });
}

test("redirects legacy cookie settings to public account legal", async ({
  baseURL,
  context,
  page,
}) => {
  await expectNoAuthSessionCookie(context);
  await page.goto(legacyCookieSettingsPath, {
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  await expect(page).toHaveURL(
    new URL(publicAccountLegalPath, requireBaseUrl(baseURL)).toString()
  );

  await dismissLegalCookieConsent(page, locale);
  await expectPublicAccountLegal(page);
});

test("persists and restores the anonymous analytics choice across reload", async ({
  context,
  page,
}) => {
  await expectNoAuthSessionCookie(context);

  const switchForCategory = (category: CookieCategory) =>
    page.getByRole("switch", {
      exact: true,
      name: cookieCategoryTitles[category],
    });

  const expectSwitchState = async (
    category: CookieCategory,
    checked: boolean
  ) => {
    await expect(switchForCategory(category)).toHaveAttribute(
      "aria-checked",
      checked ? "true" : "false"
    );
  };

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(publicAccountLegalPath, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    await dismissLegalCookieConsent(page, locale);

    const expectNecessaryCheckedDisabled = async () => {
      const necessarySwitch = switchForCategory("necessary");
      await expect(necessarySwitch).toHaveAttribute("aria-checked", "true");
      await expect(necessarySwitch).toBeDisabled();
    };

    const toggle = async (
      category: Exclude<CookieCategory, "necessary">,
      checked: boolean
    ) => {
      const categorySwitch = switchForCategory(category);
      await waitForCookieSwitchHandler(page, category);
      await expect(categorySwitch).toBeEnabled();
      // Playwright's locator activation sends a trusted browser interaction;
      // no evaluated DOM click or consent-cookie value is used here.
      await categorySwitch.click({
        timeout: workspaceE2ETimeouts.browserAction,
      });
      await expectSwitchState(category, checked);
    };

    await expectNecessaryCheckedDisabled();
    await toggle("preferences", true);

    await toggle("analytics", true);
    await toggle("marketing", true);
    await expectNecessaryCheckedDisabled();

    await page.reload({
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    await dismissLegalCookieConsent(page, locale);

    await expectSwitchState("analytics", true);
    await expectSwitchState("marketing", true);
    await expectSwitchState("preferences", true);
    await expectNecessaryCheckedDisabled();

    await toggle("analytics", false);
    await expectSwitchState("marketing", true);
    await expectNecessaryCheckedDisabled();

    await toggle("marketing", false);
    await expectNecessaryCheckedDisabled();

    await toggle("preferences", false);
    await expectNecessaryCheckedDisabled();
  }
});
