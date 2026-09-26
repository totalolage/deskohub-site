import { type BrowserContext, expect, type Page } from "@playwright/test";
import { m } from "@/features/i18n";
import { hasReactClickHandler } from "../legal-cookie-consent";
import { workspaceE2ETimeouts } from "../timeouts";

const locale = "en-US" as const;
const siteHeaderDesktopBreakpoint = 1_280;
const accountNavigationLabel = m.accountNavigationLabel({}, { locale });
const primaryNavigationLabel = m.primaryNavigationLabel({}, { locale });
const openNavigationMenuLabel = m.openNavigationMenuLabel({}, { locale });
const accountSectionLabels = {
  billing: m.accountSectionBilling({}, { locale }),
  danger: m.accountSectionDanger({}, { locale }),
  legal: m.accountSectionLegal({}, { locale }),
  profile: m.accountSectionProfile({}, { locale }),
  reservations: m.accountSectionReservations({}, { locale }),
} as const;

export type CookieCategory =
  | "necessary"
  | "analytics"
  | "marketing"
  | "preferences";

// Vendor reason: vanilla-cookieconsent v3.1 defaults to hideFromBots: true and
// aborts before cookie hydration whenever navigator.webdriver is true, which is
// always the case under Playwright. Production visitors use ordinary browsers
// where webdriver is false. This init script emulates an ordinary browser for
// that single vendor check only; it is not an auth, server, or BotID bypass.
export async function preparePublicLegalBrowser(
  context: BrowserContext
): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });
}

const cookieCategoryTitles = {
  necessary: m.cookieSettingsNecessaryTitle({}, { locale }),
  analytics: m.cookieSettingsAnalyticsTitle({}, { locale }),
  marketing: m.cookieSettingsMarketingTitle({}, { locale }),
  preferences: m.cookieSettingsPreferencesTitle({}, { locale }),
} as const;

export async function expectNoAuthSessionCookie(
  context: BrowserContext
): Promise<void> {
  const authCookies = (await context.cookies()).filter(({ name }) =>
    name.includes("session_token")
  );
  expect(authCookies.length).toBe(0);
}

export async function expectPublicAccountLegal(page: Page): Promise<void> {
  await expectResponsivePublicSiteShell(page);
  const accountMain = page.getByRole("main");
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 1,
      name: m.accountTitle({}, { locale }),
    })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 2,
      name: m.accountLegalTitle({}, { locale }),
    })
  ).toBeVisible();
  await expect(
    accountMain.getByRole("link", {
      exact: true,
      name: m.footerPrivacyLink({}, { locale }),
    })
  ).toBeVisible();

  await expect(
    accountMain.getByRole("button", {
      exact: true,
      name: m.cookieSettingsAcceptAll({}, { locale }),
    })
  ).toHaveCount(0);
  await expect(
    accountMain.getByRole("button", {
      exact: true,
      name: m.cookieSettingsRejectAll({}, { locale }),
    })
  ).toHaveCount(0);

  for (const [category, title] of Object.entries(cookieCategoryTitles)) {
    const categorySwitch = accountMain.getByRole("switch", {
      exact: true,
      name: title,
    });
    await expect(categorySwitch).toBeVisible();
    if (category === "necessary") {
      await expect(categorySwitch).toHaveAttribute("aria-checked", "true");
      await expect(categorySwitch).toBeDisabled();
    } else {
      await expect(categorySwitch).toBeEnabled();
    }
  }

  const accountNavigation = page.getByRole("navigation", {
    name: accountNavigationLabel,
  });
  for (const [section, label] of Object.entries(accountSectionLabels)) {
    const buttons = accountNavigation.getByRole("button", {
      exact: true,
      includeHidden: true,
      name: label,
    });
    await expect(buttons).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const button = buttons.nth(index);
      if (section === "legal") {
        await expect(button).toBeEnabled();
      } else {
        await expect(button).toBeDisabled();
      }
    }
  }
  const activeSectionButton = accountNavigation.getByRole("button", {
    exact: true,
    name: accountSectionLabels.legal,
  });
  await expect(activeSectionButton).toHaveCount(1);
  await expect(activeSectionButton).toBeVisible();
  await expect(activeSectionButton).toHaveAttribute("aria-current", "page");

  await expect(
    page.getByRole("button", {
      exact: true,
      name: m.accountSignOut({}, { locale }),
    })
  ).toHaveCount(0);
  await expect(page.locator("[data-screen='profile-screen']")).toHaveCount(0);
  await expect(page.locator("#account-profile-form")).toHaveCount(0);
  await expect(page.locator("#account-reservations-current-title")).toHaveCount(
    0
  );
  await expect(page.locator("#account-profile-billing-kind")).toHaveCount(0);
  await expect(page.locator("#delete-account-trigger")).toHaveCount(0);
  await expect(
    page.getByText(m.accountProfileScreenTitle({}, { locale }), { exact: true })
  ).toHaveCount(0);
  await expect(
    page.getByText(m.accountProfileScreenVerifiedEmail({}, { locale }), {
      exact: true,
    })
  ).toHaveCount(0);
  await expect(
    page.getByRole("textbox", {
      exact: true,
      name: m.accountProfileEmailLabel({}, { locale }),
    })
  ).toHaveCount(0);
}

export async function waitForCookieSwitchHandler(
  page: Page,
  category: CookieCategory
): Promise<void> {
  const switchSelector = `#cookie-category-${category}`;
  await page.waitForFunction(hasReactClickHandler, switchSelector, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
}

async function expectResponsivePublicSiteShell(page: Page): Promise<void> {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const viewport = page.viewportSize();
  if (viewport === null)
    throw new Error("Public account legal requires a viewport");

  await expect
    .poll(async () => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(viewport.width + 1);

  if (viewport.width >= siteHeaderDesktopBreakpoint) {
    await expect(
      page.getByRole("navigation", {
        exact: true,
        name: primaryNavigationLabel,
      })
    ).toBeVisible();
    return;
  }

  const mobileMenuButton = page.getByRole("button", {
    exact: true,
    name: openNavigationMenuLabel,
  });
  await expect(mobileMenuButton).toBeVisible();
  await expect(mobileMenuButton).toHaveAttribute("aria-expanded", "false");
  await expect(mobileMenuButton).toHaveAttribute(
    "aria-controls",
    "site-header-mobile-menu"
  );
}
