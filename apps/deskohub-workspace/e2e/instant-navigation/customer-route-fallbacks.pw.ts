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
  await expectCookieConsentBanner(page);
});

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
