import { instant } from "@next/playwright";
import { expect, type Page, test } from "@playwright/test";
import { m } from "@/features/i18n";
import { captureAccountReview } from "../account/review-screenshots";
import { enablePreviewAccess } from "../preview-access";
import {
  expectPublicSiteShell,
  prefetchRoute,
  requireBaseUrl,
  reviewDestination,
} from "./navigation-test-helpers";

const homePath = "/en-US";
const accountPath = "/en-US/account";
const signInPath = "/en-US/auth/sign-in";
const accountStatusName = "My account | Deskohub Workspace";
const signInHeading = m.accountSignInTitle({}, { locale: "en-US" });
const signInLoadingName = m.accountSignInLoading({}, { locale: "en-US" });

if (process.env.WORKSPACE_E2E_BASE_URL === undefined) {
  throw new Error(
    "WORKSPACE_E2E_BASE_URL must be configured for account navigation tests"
  );
}

type AccountNavigationOptions = {
  readonly verifySignInHandoff?: boolean;
};

test.beforeEach(async ({ baseURL, context }) => {
  await enablePreviewAccess(context, baseURL);
});

test.describe("client navigation", () => {
  test("opens sign-in over the page from the anonymous header account button", async ({
    page,
  }) => {
    await page.goto(homePath);
    await expectPublicSiteShell(page);

    const visitedPathnames: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        visitedPathnames.push(new URL(frame.url()).pathname);
      }
    });

    const accountLink = page
      .getByRole("banner")
      .getByRole("link", { name: "Account" });
    await accountLink.click();

    await expectAnonymousSignIn(page);
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("status", { name: accountStatusName })
    ).toHaveCount(0);
    expect(visitedPathnames).not.toContain(accountPath);
  });

  test("streams the account loading shell before redirecting an anonymous client", async ({
    baseURL,
    page,
  }) => {
    await page.goto(homePath);
    await expectPublicSiteShell(page);

    await navigateToAccount(page, baseURL, { verifySignInHandoff: true });
    await expectAnonymousSignIn(page);
    // The redirect loads the sign-in page itself, not the modal.
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page
      .getByRole("banner")
      .getByRole("link", { name: "Deskohub Workspace" })
      .click();
    await expect(page).toHaveURL(new RegExp(`${homePath}$`));
    await expectPublicSiteShell(page);

    await navigateToAccount(page, baseURL);
    await expectAnonymousSignIn(page);
  });
});

// The anonymous header links to sign-in, so this drives the App Router directly
// to cover a client navigation that still lands on the account route.
async function navigateToAccount(
  page: Page,
  baseURL: string | undefined,
  options: AccountNavigationOptions = {}
) {
  await prefetchRoute(page, accountPath);
  await page.evaluate((path) => {
    document.documentElement.dataset.navigationSource = path;
  }, homePath);

  const runAccountInstantFallback = async () => {
    await instant(
      page,
      async () => {
        await page.evaluate(
          (path) => window.next?.router?.push(path),
          accountPath
        );

        await expect(page).toHaveURL(new RegExp(`${accountPath}$`));
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.dataset.navigationSource
            )
          )
          .toBe(homePath);
        await expectPublicSiteShell(page);
        const status = page.getByRole("status", { name: accountStatusName });
        await expect(status).toBeVisible();
        await captureAccountReview(
          page,
          reviewDestination(baseURL),
          "account-loading-desktop"
        );
        await expect(
          page.getByRole("heading", { name: signInHeading })
        ).toHaveCount(0);
      },
      { baseURL: requireBaseUrl(baseURL) }
    );
  };

  if (options.verifySignInHandoff) {
    await withSignInHandoffEvidence(page, runAccountInstantFallback);
    return;
  }

  await runAccountInstantFallback();
}

const signInLoadingSeenKey = "deskohub:e2e:sign-in-loading-seen";

// The redirect is a document navigation, and Playwright waits for a pending
// navigation before it reads the page, so the loading shell can't be
// inspected while the sign-in request is held. Instead the browser records
// it in sessionStorage, which the same tab keeps across the navigation.
async function withSignInHandoffEvidence(
  page: Page,
  runAccountInstantFallback: () => Promise<void>
) {
  const recordSignInLoading = ({
    key,
    name,
  }: {
    readonly key: string;
    readonly name: string;
  }) => {
    sessionStorage.removeItem(key);
    const record = () => {
      if (document.querySelector(`[role="status"][aria-label="${name}"]`)) {
        sessionStorage.setItem(key, "1");
      }
    };
    new MutationObserver(record).observe(document, {
      childList: true,
      subtree: true,
    });
  };
  const recorder = { key: signInLoadingSeenKey, name: signInLoadingName };
  // The client navigation to the account stays in this document.
  await page.evaluate(recordSignInLoading, recorder);
  await runAccountInstantFallback();
  await expectAnonymousSignIn(page);
  expect(
    await page.evaluate(
      (key) => sessionStorage.getItem(key),
      signInLoadingSeenKey
    )
  ).toBe("1");
}

async function expectAnonymousSignIn(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${signInPath}$`));
  await expect(
    page.getByRole("heading", { level: 1, name: signInHeading })
  ).toBeVisible();
}
