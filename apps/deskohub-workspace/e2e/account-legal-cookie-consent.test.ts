import { describe, test } from "bun:test";
import { expect as expectLocator, type Page } from "@playwright/test";
import { m } from "@/features/i18n";
import {
  type AccountLegalFixture,
  accountFixtureCaseTimeout,
  closeFixtureContext,
  openFixtureContext,
  registerAccountLegalFixture,
  type Viewport,
} from "./account-legal-fixture";
import {
  type CookieCategory,
  expectNoAuthSessionCookie,
  expectPublicAccountLegal,
  preparePublicLegalBrowser,
  waitForCookieSwitchHandler,
} from "./instant-navigation/public-account-legal-assertions";
import { dismissLegalCookieConsent } from "./legal-cookie-consent";

const realCookieConsentLocale = "en-US" as const;
const realCookieConsentViewports = [
  { height: 900, name: "desktop 1440", width: 1440 },
] as const;
const realCookieConsentCategoryTitles = {
  necessary: m.cookieSettingsNecessaryTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
  analytics: m.cookieSettingsAnalyticsTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
  marketing: m.cookieSettingsMarketingTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
  preferences: m.cookieSettingsPreferencesTitle(
    {},
    { locale: realCookieConsentLocale }
  ),
} as const;
const realCookieBrowserActionTimeout = 15_000;

const realCookieSwitch = (page: Page, category: CookieCategory) =>
  page.getByRole("switch", {
    exact: true,
    name: realCookieConsentCategoryTitles[category],
  });

const expectRealCookieSwitchState = async (
  page: Page,
  category: CookieCategory,
  checked: boolean
) => {
  await expectLocator(realCookieSwitch(page, category)).toHaveAttribute(
    "aria-checked",
    checked ? "true" : "false"
  );
};

const toggleRealCookieCategory = async (
  page: Page,
  category: Exclude<CookieCategory, "necessary">,
  checked: boolean
) => {
  const categorySwitch = realCookieSwitch(page, category);
  const expectedChecked = checked ? "true" : "false";

  // A click can be lost when it lands while the previous consent update is
  // still re-rendering the category cards; retry against the fresh node.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForCookieSwitchHandler(page, category);
    await expectLocator(categorySwitch).toBeEnabled();
    // Playwright's locator activation sends a trusted browser interaction;
    // no evaluated DOM click or consent-cookie value is written here.
    await categorySwitch.click({
      timeout: realCookieBrowserActionTimeout,
    });
    try {
      await expectLocator(categorySwitch).toHaveAttribute(
        "aria-checked",
        expectedChecked,
        { timeout: 5_000 }
      );
      break;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }

  // Settle: the card's pending state has cleared and the handler is reattached
  // before the next trusted click.
  await waitForCookieSwitchHandler(page, category);
  await expectLocator(categorySwitch).toBeEnabled();
};

const navigateToConsentWaypointAndBack = async (
  page: Page,
  serverUrl: string
) => {
  const localePath = `/${realCookieConsentLocale}`;
  const mobileMenuButton = page.getByRole("button", {
    exact: true,
    name: m.openNavigationMenuLabel({}, { locale: realCookieConsentLocale }),
  });
  if (await mobileMenuButton.isVisible()) {
    await mobileMenuButton.click({
      timeout: realCookieBrowserActionTimeout,
    });
  }

  const contactLink = page.getByRole("banner").getByRole("link", {
    exact: true,
    name: "Contact",
  });
  await contactLink.click({ timeout: realCookieBrowserActionTimeout });
  await page.waitForURL(`${serverUrl}${localePath}/consent-waypoint`);
  await page
    .getByRole("heading", { name: "Synthetic consent waypoint" })
    .waitFor({ state: "visible" });

  const backLink = page.getByRole("link", {
    exact: true,
    name: "Back to public legal",
  });
  await backLink.click({ timeout: realCookieBrowserActionTimeout });
  await page.waitForURL(`${serverUrl}${localePath}/account/legal`);
};

const runRealCookieConsentContinuity = async (
  fixture: AccountLegalFixture,
  viewport: Viewport
) => {
  const context = await openFixtureContext(fixture, { viewport });
  // Emulate an ordinary browser so the real vendor hydration runs exactly as
  // it does for human visitors (the vendor skips cookie hydration under
  // navigator.webdriver); no cookies are injected and no auth is bypassed.
  await preparePublicLegalBrowser(context);
  const page = await context.newPage();

  try {
    await expectNoAuthSessionCookie(context);
    await page.goto(
      `${fixture.serverUrl}/${realCookieConsentLocale}/account/legal`,
      { waitUntil: "domcontentloaded" }
    );
    await page
      .locator('[data-fixture-hydrated="true"]')
      .waitFor({ state: "attached" });
    await dismissLegalCookieConsent(page, realCookieConsentLocale);
    await expectPublicAccountLegal(page);

    await toggleRealCookieCategory(page, "preferences", true);
    await toggleRealCookieCategory(page, "analytics", true);
    await toggleRealCookieCategory(page, "marketing", true);
    await expectRealCookieSwitchState(page, "necessary", true);
    await expectLocator(realCookieSwitch(page, "necessary")).toBeDisabled();

    await navigateToConsentWaypointAndBack(page, fixture.serverUrl);
    await page
      .getByRole("heading", {
        exact: true,
        level: 2,
        name: m.accountLegalTitle({}, { locale: realCookieConsentLocale }),
      })
      .waitFor({ state: "visible" });
    for (const category of ["analytics", "marketing", "preferences"] as const) {
      await expectRealCookieSwitchState(page, category, true);
    }

    await page.reload({ waitUntil: "load" });
    await dismissLegalCookieConsent(page, realCookieConsentLocale);
    for (const category of ["analytics", "marketing", "preferences"] as const) {
      await expectRealCookieSwitchState(page, category, true);
    }
    await expectRealCookieSwitchState(page, "necessary", true);
    await expectLocator(realCookieSwitch(page, "necessary")).toBeDisabled();

    await toggleRealCookieCategory(page, "analytics", false);
    await expectRealCookieSwitchState(page, "marketing", true);
    await expectRealCookieSwitchState(page, "preferences", true);

    await toggleRealCookieCategory(page, "marketing", false);
    await expectRealCookieSwitchState(page, "preferences", true);

    await toggleRealCookieCategory(page, "preferences", false);
    await expectRealCookieSwitchState(page, "necessary", true);
    await expectLocator(realCookieSwitch(page, "necessary")).toBeDisabled();
    await expectNoAuthSessionCookie(context);
  } finally {
    await closeFixtureContext(fixture, context);
  }
};

describe("account legal continuity real cookie consent fixture", () => {
  const requireFixture = registerAccountLegalFixture({
    realCookieConsent: true,
  });

  for (const { height, name, width } of realCookieConsentViewports) {
    test(`keeps ${name} real cookie switches persistent across navigation and reload`, {
      timeout: accountFixtureCaseTimeout,
    }, async () => {
      await runRealCookieConsentContinuity(requireFixture(), {
        height,
        width,
      });
    });
  }
});
