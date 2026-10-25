import { expect, type Page, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { enablePreviewAccess } from "../preview-access";
import { preparePublicLegalBrowser } from "./public-account-legal-assertions";

const locale = "en-US" as const;

test.beforeEach(async ({ baseURL, context }) => {
  await preparePublicLegalBrowser(context);
  await enablePreviewAccess(context, baseURL);
});

// The consent banner comes from the customer providers, so it shows only when
// the fallback renders inside them.
async function expectCookieConsentBanner(page: Page) {
  await expect(
    page.getByRole("dialog", {
      name: m.cookieConsentConsentModalTitle({}, { locale }),
    })
  ).toBeVisible();
}

test("renders the not-found page for an unknown address inside the customer providers", async ({
  page,
}) => {
  const response = await page.goto("/en-US/route-fallback-unknown-address");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.notFoundTitle({}, { locale }),
    })
  ).toBeVisible();
  // Inside the locale layout, not Next's bare error document.
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
  await expect(page).toHaveTitle(/\S/);
  await expectCookieConsentBanner(page);
});

// Dotted paths skip the proxy's page handling, so a file-like address takes
// its own way to the localized catch-all: the locale redirect outside the
// locales, including under a prefix that names no locale, and the
// exact-locale redirect under a wrong-case one.
for (const [prefix, localizedPrefix] of [
  ["", `/${locale}`],
  ["/EN-us", `/${locale}`],
  ["/de-de", `/${locale}/de-de`],
] as const) {
  test(`renders the localized not-found page for an unknown file address at "${prefix}/"`, async ({
    page,
  }) => {
    await page.setExtraHTTPHeaders({ "Accept-Language": "en" });
    const response = await page.goto(
      `${prefix}/route-fallback-unknown-file.html`
    );

    expect(response?.status()).toBe(404);
    expect(new URL(page.url()).pathname).toBe(
      `${localizedPrefix}/route-fallback-unknown-file.html`
    );
    // The server's HTML is the locale layout, not Next's bare error document.
    const html = await response?.text();
    expect(html).toMatch(
      new RegExp(`<html(?![^>]*__next_error__)[^>]*\\blang="${locale}"`)
    );
    expect(html).toMatch(/<title[^>]*>[^<]*\S[^<]*<\/title>/);
    expect(html).toMatch(/<meta name="robots" content="[^"]*noindex/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: m.notFoundTitle({}, { locale }),
      })
    ).toBeVisible();
  });
}

test("renders the error page for a failing page inside the customer providers", async ({
  page,
}) => {
  await page.goto("/en-US/route-error-preview");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: m.errorPageTitle({}, { locale }),
    })
  ).toBeVisible();
  await expectCookieConsentBanner(page);
});
