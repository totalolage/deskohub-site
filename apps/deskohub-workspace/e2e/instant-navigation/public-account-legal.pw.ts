import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { workspaceE2ETimeouts } from "../timeouts";
import { enablePreviewAccess, requireBaseUrl } from "./navigation-test-helpers";

const locale = "en-US" as const;
const publicAccountLegalPath = `/${locale}/account/legal`;
const legacyCookieSettingsPath = `/${locale}/cookie-settings`;
const analyticsCheckboxSelector = "#cookie-category-analytics";
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
const consentModalNecessaryOnlyLabel =
  m.cookieConsentConsentModalAcceptNecessaryBtn({}, { locale });
const viewports = [
  { height: 1_000, name: "desktop", width: 1_440 },
  { height: 900, name: "mobile 375", width: 375 },
] as const;

test.beforeEach(async ({ baseURL, context }) => {
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

    await dismissConsentModal(page);
    await expectPublicAccountLegal(page);
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

  await dismissConsentModal(page);
  await expectPublicAccountLegal(page);
});

test("persists and restores the anonymous analytics choice across reload", async ({
  context,
  page,
}) => {
  await expectNoAuthSessionCookie(context);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.goto(publicAccountLegalPath, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    await dismissConsentModal(page);

    const analyticsCheckbox = page.locator(analyticsCheckboxSelector);
    await expect(analyticsCheckbox).toBeVisible();
    await expect(analyticsCheckbox).toHaveAttribute("aria-checked", "false");
    await waitForAnalyticsCheckboxHandler(page);

    // Playwright's locator activation sends a trusted browser interaction;
    // no evaluated DOM click or consent-cookie value is used here.
    await analyticsCheckbox.click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(analyticsCheckbox).toHaveAttribute("aria-checked", "true");

    await page.reload({
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    await dismissConsentModal(page);
    await expect(analyticsCheckbox).toHaveAttribute("aria-checked", "true");

    await waitForAnalyticsCheckboxHandler(page);
    await analyticsCheckbox.click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(analyticsCheckbox).toHaveAttribute("aria-checked", "false");
  }
});

async function expectNoAuthSessionCookie(context: BrowserContext) {
  const authCookies = (await context.cookies()).filter(({ name }) =>
    name.includes("session_token")
  );
  expect(authCookies.length).toBe(0);
}

async function dismissConsentModal(page: Page) {
  const necessaryOnlyButton = page.getByRole("button", {
    exact: true,
    name: consentModalNecessaryOnlyLabel,
  });

  await expect
    .poll(
      async () =>
        (await necessaryOnlyButton.isVisible()) ||
        ((await page.locator(analyticsCheckboxSelector).isVisible()) &&
          (await page.evaluate(
            hasReactClickHandler,
            analyticsCheckboxSelector
          ))),
      { timeout: workspaceE2ETimeouts.uiTransition }
    )
    .toBe(true);

  if (await necessaryOnlyButton.isVisible()) {
    await necessaryOnlyButton.click({
      timeout: workspaceE2ETimeouts.browserAction,
    });
    await expect(necessaryOnlyButton).toBeHidden({
      timeout: workspaceE2ETimeouts.browserAction,
    });
  }
}

async function expectPublicAccountLegal(page: Page) {
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

  for (const category of [
    "necessary",
    "analytics",
    "marketing",
    "preferences",
  ] as const) {
    await expect(page.locator(`#cookie-category-${category}`)).toBeVisible();
  }
  await expect(
    page.getByRole("button", {
      exact: true,
      name: m.cookieSettingsAcceptAll({}, { locale }),
    })
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      exact: true,
      name: m.cookieSettingsRejectAll({}, { locale }),
    })
  ).toBeVisible();

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
  await expect(page.locator("[data-slot='profile-screen']")).toHaveCount(0);
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

async function expectResponsivePublicSiteShell(page: Page) {
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("contentinfo")).toBeVisible();

  const viewport = page.viewportSize();
  if (viewport === null)
    throw new Error("Public account legal requires a viewport");

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

async function waitForAnalyticsCheckboxHandler(page: Page) {
  await page.waitForFunction(hasReactClickHandler, analyticsCheckboxSelector, {
    timeout: workspaceE2ETimeouts.uiTransition,
  });
}

function hasReactClickHandler(selector: string): boolean {
  const element = document.querySelector(selector);
  if (element === null) return false;

  const reactPropsKey = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$")
  );
  if (reactPropsKey === undefined) return false;

  const reactProps = Object.getOwnPropertyDescriptor(
    element,
    reactPropsKey
  )?.value;
  if (typeof reactProps !== "object" || reactProps === null) return false;

  return (
    "onClick" in reactProps &&
    typeof (reactProps as { readonly onClick?: unknown }).onClick === "function"
  );
}
