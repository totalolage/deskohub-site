import { equal } from "node:assert/strict";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EReservationHistoryFixture } from "./reservation-history-fixture";

export type WorkspaceE2EReservationStatusReviewStage = "modal" | "details";

type ReservationHistoryNavigationInput = {
  readonly baseUrl: string;
  readonly browser: Browser;
  readonly bypassSecret: string | undefined;
  readonly captureStatusReview: (
    stage: WorkspaceE2EReservationStatusReviewStage
  ) => Promise<void>;
  readonly fixture: WorkspaceE2EReservationHistoryFixture;
  readonly page: Page;
};

export type WorkspaceE2EReservationHistoryUrls = {
  readonly accessPath: string;
  readonly accessUrl: string;
  readonly accountPath: string;
  readonly accountUrl: string;
  readonly statusPath: string;
  readonly statusUrl: string;
};

export const makeWorkspaceE2EReservationHistoryUrls = (
  baseUrl: string,
  reservationId: WorkspaceReservationId
): WorkspaceE2EReservationHistoryUrls => {
  const accountPath = "/en-US/account";
  const statusPath = `/en-US${reservationStatusPath}/${encodeURIComponent(reservationId)}`;
  const accessPath = `/en-US${reservationAccessPath}/${encodeURIComponent(reservationId)}`;

  return {
    accessPath,
    accessUrl: new URL(accessPath, baseUrl).toString(),
    accountPath,
    accountUrl: new URL(accountPath, baseUrl).toString(),
    statusPath,
    statusUrl: new URL(statusPath, baseUrl).toString(),
  };
};

const expectFulfilledStatus = async (
  page: Page,
  fixture: WorkspaceE2EReservationHistoryFixture
) => {
  await expect(
    page.getByText(fixture.reservationId, { exact: true })
  ).toBeVisible();
  await expect(page.locator("#checkout-status-access")).toBeVisible();
  await expect(page.locator("[data-reservation-access-code]")).toHaveCount(0);
};

export const expectWorkspaceE2EReservationNotFound = async (
  page: Page,
  reservationId: WorkspaceReservationId
) => {
  const notFoundTitle = m.checkoutStatusNotFoundTitle(
    {},
    { locale: "en-US" satisfies Locale }
  );
  await expect(
    page.getByRole("heading", {
      exact: true,
      level: 1,
      name: notFoundTitle,
    })
  ).toBeVisible();
  await expect(page.getByText(reservationId, { exact: true })).toHaveCount(0);
  await expect(page.locator("#checkout-status-access")).toHaveCount(0);
};

const expectUnavailableAccess = async (page: Page) => {
  const unavailableTitle = m.reservationAccessUnavailableTitle(
    {},
    { locale: "en-US" satisfies Locale }
  );
  const invalidLinkTitle = m.reservationAccessInvalidLinkTitle(
    {},
    { locale: "en-US" satisfies Locale }
  );
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: unavailableTitle })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: invalidLinkTitle })
  ).toHaveCount(0);
  await expect(page.locator("[data-reservation-access]")).toBeVisible();
  await expect(page.locator("[data-reservation-access-code]")).toHaveCount(0);
};

const expectInvalidAccess = async (
  page: Page,
  fixture: WorkspaceE2EReservationHistoryFixture
) => {
  const invalidLinkTitle = m.reservationAccessInvalidLinkTitle(
    {},
    { locale: "en-US" satisfies Locale }
  );
  const unavailableTitle = m.reservationAccessUnavailableTitle(
    {},
    { locale: "en-US" satisfies Locale }
  );
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: invalidLinkTitle })
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, level: 1, name: unavailableTitle })
  ).toHaveCount(0);
  await expect(
    page.getByText(fixture.reservationId, { exact: true })
  ).toHaveCount(0);
  await expect(page.locator("[data-reservation-access-code]")).toHaveCount(0);
};

const primePreviewAccess = async (
  context: BrowserContext,
  baseUrl: string,
  bypassSecret: string | undefined
) => {
  if (!bypassSecret) return;

  const response = await context.request.get(
    new URL("/favicon.svg", baseUrl).toString(),
    {
      headers: {
        "x-vercel-protection-bypass": bypassSecret,
        "x-vercel-set-bypass-cookie": "true",
      },
      maxRedirects: 3,
    }
  );
  try {
    equal(response.ok(), true, "preview access could not be primed");
  } finally {
    await response.dispose();
  }
};

const verifyPrivateRoutes = async (
  input: ReservationHistoryNavigationInput,
  urls: WorkspaceE2EReservationHistoryUrls
) => {
  const context = await input.browser.newContext({ baseURL: input.baseUrl });
  try {
    await primePreviewAccess(context, input.baseUrl, input.bypassSecret);
    const page = await context.newPage();
    const statusResponse = await page.goto(urls.statusUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    equal(statusResponse?.status(), 200, "private status route did not load");
    await expectWorkspaceE2EReservationNotFound(
      page,
      input.fixture.reservationId
    );

    const invalidAccessResponse = await page.goto(urls.accessUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    });
    equal(
      invalidAccessResponse?.status(),
      200,
      "tokenless reservation access link did not load"
    );
    await expectInvalidAccess(page, input.fixture);
  } finally {
    await context.close();
  }
};

export const verifyWorkspaceE2EReservationHistoryNavigation = async (
  input: ReservationHistoryNavigationInput
): Promise<void> => {
  const urls = makeWorkspaceE2EReservationHistoryUrls(
    input.baseUrl,
    input.fixture.reservationId
  );

  await input.page.goto(urls.accountUrl, {
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  const historyLink = pageReservationLink(input.page, urls.statusPath);

  await expect(historyLink).toHaveCount(1);
  await Promise.all([
    input.page.waitForURL(urls.statusUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    historyLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expect(input.page.getByRole("dialog")).toBeVisible();
  await expectFulfilledStatus(input.page, input.fixture);
  await input.captureStatusReview("modal");

  const closeButton = input.page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true });
  await Promise.all([
    input.page.waitForURL(urls.accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    closeButton.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expect(input.page.getByRole("dialog")).toHaveCount(0);

  await input.page.goto(urls.statusUrl, {
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  await expect(input.page.getByRole("dialog")).toHaveCount(0);
  await expectFulfilledStatus(input.page, input.fixture);

  await input.page.goto(urls.accountUrl, {
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  const reopenHistoryLink = pageReservationLink(input.page, urls.statusPath);
  await expect(reopenHistoryLink).toHaveCount(1);
  await Promise.all([
    input.page.waitForURL(urls.statusUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    reopenHistoryLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expect(input.page.getByRole("dialog")).toBeVisible();
  await expectFulfilledStatus(input.page, input.fixture);

  await Promise.all([
    input.page.waitForURL(urls.accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    input.page.goBack({
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    }),
  ]);
  await expect(input.page.getByRole("dialog")).toHaveCount(0);

  await Promise.all([
    input.page.waitForURL(urls.statusUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    input.page.goForward({
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    }),
  ]);
  await expect(input.page.getByRole("dialog")).toBeVisible();
  await expectFulfilledStatus(input.page, input.fixture);

  await input.page.reload({
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  await expect(input.page.getByRole("dialog")).toHaveCount(0);
  await expectFulfilledStatus(input.page, input.fixture);
  await input.captureStatusReview("details");

  const accessLink = input.page.locator("#checkout-status-access");
  await Promise.all([
    input.page.waitForURL(urls.accessUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    accessLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expectUnavailableAccess(input.page);

  const reciprocalStatusLink = pageReservationLink(input.page, urls.statusPath);
  await expect(reciprocalStatusLink).toHaveCount(1);
  await Promise.all([
    input.page.waitForURL(urls.statusUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
    }),
    reciprocalStatusLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
  ]);
  await expect(input.page.getByRole("dialog")).toBeVisible();
  await expectFulfilledStatus(input.page, input.fixture);

  await input.page.goto(urls.accountUrl, {
    timeout: workspaceE2ETimeouts.browserNavigation,
    waitUntil: "load",
  });
  await expect(pageReservationLink(input.page, urls.statusPath)).toHaveCount(1);
  await verifyPrivateRoutes(input, urls);
};

const pageReservationLink = (page: Page, statusPath: string) =>
  page.locator(`a[href="${statusPath}"]`);
