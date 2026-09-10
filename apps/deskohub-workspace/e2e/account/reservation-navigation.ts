import { equal } from "node:assert/strict";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Data } from "effect";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  reservationAccessPath,
  reservationStatusPath,
} from "@/features/reservation/routes";
import { workspaceE2EError } from "../errors";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EReservationHistoryFixture } from "./reservation-history-fixture";

export type WorkspaceE2EReservationStatusReviewStage = "modal" | "details";

export type WorkspaceE2EReservationHistorySubstage =
  | "history-load"
  | "history-open-link"
  | "history-open-hydration"
  | "history-open-url"
  | "history-open-click"
  | "modal-assert-dialog"
  | "modal-assert-content"
  | "modal-capture"
  | "modal-close-url"
  | "modal-close-click"
  | "modal-close-dialog"
  | "canonical-direct-load"
  | "canonical-direct-dialog"
  | "canonical-direct-content"
  | "history-reopen-load"
  | "history-reopen-link"
  | "history-reopen-hydration"
  | "history-reopen-url"
  | "history-reopen-click"
  | "history-reopen-dialog"
  | "history-reopen-content"
  | "history-back-url"
  | "history-back-action"
  | "history-back-dialog"
  | "history-forward-url"
  | "history-forward-action"
  | "history-forward-dialog"
  | "history-forward-content"
  | "details-reload"
  | "details-assert-dialog"
  | "details-assert-content"
  | "details-capture"
  | "access-open-url"
  | "access-open-click"
  | "access-open-assert"
  | "access-details-return-link"
  | "access-details-return-hydration"
  | "access-details-return-url"
  | "access-details-return-click"
  | "access-details-return-dialog"
  | "access-details-return-content"
  | "history-final-load"
  | "history-final-link"
  | "anonymous-status-load"
  | "anonymous-status-assert"
  | "anonymous-access-load"
  | "anonymous-access-assert";

export type WorkspaceE2EReservationHistoryFailureKind =
  | "assertion"
  | "timeout"
  | "error";

export class WorkspaceE2EReservationHistoryNavigationError extends Data.TaggedError(
  "WorkspaceE2EReservationHistoryNavigationError"
)<{
  readonly kind: WorkspaceE2EReservationHistoryFailureKind;
  readonly message: string;
  readonly stage: WorkspaceE2EReservationHistorySubstage;
}> {}

const reservationHistoryNavigationFailure = (
  stage: WorkspaceE2EReservationHistorySubstage,
  kind: WorkspaceE2EReservationHistoryFailureKind
) =>
  new WorkspaceE2EReservationHistoryNavigationError({
    kind,
    message: `Account reservation history navigation failed at ${stage}`,
    stage,
  });

const classifyReservationHistoryFailure = (
  cause: unknown
): WorkspaceE2EReservationHistoryFailureKind =>
  cause instanceof Error && cause.name === "TimeoutError" ? "timeout" : "error";

export const runReservationHistoryStage = async <A>(
  stage: WorkspaceE2EReservationHistorySubstage,
  operation: () => Promise<A>,
  kind?: WorkspaceE2EReservationHistoryFailureKind
): Promise<A> => {
  try {
    return await operation();
  } catch (cause) {
    if (cause instanceof WorkspaceE2EReservationHistoryNavigationError) {
      throw cause;
    }
    throw reservationHistoryNavigationFailure(
      stage,
      kind ?? classifyReservationHistoryFailure(cause)
    );
  }
};

export const workspaceE2EReservationHistoryFailureDetails = (cause: unknown) =>
  cause instanceof WorkspaceE2EReservationHistoryNavigationError
    ? {
        message: `verify account reservation history navigation failed at ${cause.stage} (${cause.kind})`,
        operation: `verify account reservation history navigation at ${cause.stage}`,
      }
    : {
        message: "verify account reservation history navigation failed",
        operation: "verify account reservation history navigation",
      };

export const toWorkspaceE2EReservationHistoryFailure = (cause: unknown) => {
  const { message, operation } =
    workspaceE2EReservationHistoryFailureDetails(cause);
  return workspaceE2EError(message, { operation });
};

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

type WorkspaceE2EReservationStatusPresentation = "modal" | "page";

export const workspaceE2EReservationStatusLinkHydrationPredicate = (
  expectedStatusPath: string,
  documentObject: Pick<Document, "querySelectorAll"> = document
): boolean => {
  const link = Array.from(documentObject.querySelectorAll("a")).find(
    (candidate) => candidate.getAttribute("href") === expectedStatusPath
  );
  if (link === undefined) return false;

  const reactPropsKey = Object.keys(link).find((key) =>
    key.startsWith("__reactProps$")
  );
  const reactProps =
    reactPropsKey === undefined
      ? undefined
      : Object.getOwnPropertyDescriptor(link, reactPropsKey)?.value;
  return (
    typeof reactProps === "object" &&
    reactProps !== null &&
    "onClick" in reactProps &&
    typeof reactProps.onClick === "function"
  );
};

const expectFulfilledStatus = async (
  page: Page,
  fixture: WorkspaceE2EReservationHistoryFixture,
  mode: WorkspaceE2EReservationStatusPresentation
) => {
  const root =
    mode === "modal" ? page.getByRole("dialog") : page.getByRole("main");
  await expect(root).toBeVisible();
  await expect(
    root.getByText(fixture.reservationId, { exact: true })
  ).toBeVisible();
  await expect(root.locator("#checkout-status-access")).toBeVisible();
  await expect(page.locator("[data-reservation-access-code]")).toHaveCount(0);
};

const waitForReservationStatusLinkHydration = async (
  page: Page,
  statusPath: string
): Promise<void> => {
  await page.waitForFunction(
    workspaceE2EReservationStatusLinkHydrationPredicate,
    statusPath,
    { timeout: workspaceE2ETimeouts.uiTransition }
  );
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

const runReservationHistoryNavigationPair = async ({
  action,
  actionStage,
  page,
  url,
  urlStage,
}: {
  readonly action: () => Promise<unknown>;
  readonly actionStage: WorkspaceE2EReservationHistorySubstage;
  readonly page: Page;
  readonly url: string;
  readonly urlStage: WorkspaceE2EReservationHistorySubstage;
}) =>
  Promise.all([
    runReservationHistoryStage(urlStage, () =>
      page.waitForURL(url, {
        timeout: workspaceE2ETimeouts.browserNavigation,
      })
    ),
    runReservationHistoryStage(actionStage, action),
  ]);

const verifyPrivateRoutes = async (
  input: ReservationHistoryNavigationInput,
  urls: WorkspaceE2EReservationHistoryUrls
) => {
  const context = await input.browser.newContext({ baseURL: input.baseUrl });
  try {
    await primePreviewAccess(context, input.baseUrl, input.bypassSecret);
    const page = await context.newPage();
    const statusResponse = await runReservationHistoryStage(
      "anonymous-status-load",
      () =>
        page.goto(urls.statusUrl, {
          timeout: workspaceE2ETimeouts.browserNavigation,
          waitUntil: "load",
        })
    );
    await runReservationHistoryStage(
      "anonymous-status-assert",
      async () => {
        equal(
          statusResponse?.status(),
          200,
          "private status route did not load"
        );
        await expectWorkspaceE2EReservationNotFound(
          page,
          input.fixture.reservationId
        );
      },
      "assertion"
    );

    const invalidAccessResponse = await runReservationHistoryStage(
      "anonymous-access-load",
      () =>
        page.goto(urls.accessUrl, {
          timeout: workspaceE2ETimeouts.browserNavigation,
          waitUntil: "load",
        })
    );
    await runReservationHistoryStage(
      "anonymous-access-assert",
      async () => {
        equal(
          invalidAccessResponse?.status(),
          200,
          "tokenless reservation access link did not load"
        );
        await expectInvalidAccess(page, input.fixture);
      },
      "assertion"
    );
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

  await runReservationHistoryStage("history-load", () =>
    input.page.goto(urls.accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    })
  );
  const historyLink = pageReservationLink(input.page, urls.statusPath);

  await runReservationHistoryStage(
    "history-open-link",
    () => expect(historyLink).toHaveCount(1),
    "assertion"
  );
  await runReservationHistoryStage("history-open-hydration", () =>
    waitForReservationStatusLinkHydration(input.page, urls.statusPath)
  );
  await runReservationHistoryNavigationPair({
    action: () =>
      historyLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
    actionStage: "history-open-click",
    page: input.page,
    url: urls.statusUrl,
    urlStage: "history-open-url",
  });
  await runReservationHistoryStage(
    "modal-assert-dialog",
    () => expect(input.page.getByRole("dialog")).toBeVisible(),
    "assertion"
  );
  await runReservationHistoryStage(
    "modal-assert-content",
    () => expectFulfilledStatus(input.page, input.fixture, "modal"),
    "assertion"
  );
  await runReservationHistoryStage("modal-capture", () =>
    input.captureStatusReview("modal")
  );

  const closeButton = input.page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true });
  await runReservationHistoryNavigationPair({
    action: () =>
      closeButton.click({ timeout: workspaceE2ETimeouts.browserAction }),
    actionStage: "modal-close-click",
    page: input.page,
    url: urls.accountUrl,
    urlStage: "modal-close-url",
  });
  await runReservationHistoryStage(
    "modal-close-dialog",
    () => expect(input.page.getByRole("dialog")).toHaveCount(0),
    "assertion"
  );

  await runReservationHistoryStage("canonical-direct-load", () =>
    input.page.goto(urls.statusUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    })
  );
  await runReservationHistoryStage(
    "canonical-direct-dialog",
    () => expect(input.page.getByRole("dialog")).toHaveCount(0),
    "assertion"
  );
  await runReservationHistoryStage(
    "canonical-direct-content",
    () => expectFulfilledStatus(input.page, input.fixture, "page"),
    "assertion"
  );

  await runReservationHistoryStage("history-reopen-load", () =>
    input.page.goto(urls.accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    })
  );
  const reopenHistoryLink = pageReservationLink(input.page, urls.statusPath);
  await runReservationHistoryStage(
    "history-reopen-link",
    () => expect(reopenHistoryLink).toHaveCount(1),
    "assertion"
  );
  await runReservationHistoryStage("history-reopen-hydration", () =>
    waitForReservationStatusLinkHydration(input.page, urls.statusPath)
  );
  await runReservationHistoryNavigationPair({
    action: () =>
      reopenHistoryLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
    actionStage: "history-reopen-click",
    page: input.page,
    url: urls.statusUrl,
    urlStage: "history-reopen-url",
  });
  await runReservationHistoryStage(
    "history-reopen-dialog",
    () => expect(input.page.getByRole("dialog")).toBeVisible(),
    "assertion"
  );
  await runReservationHistoryStage(
    "history-reopen-content",
    () => expectFulfilledStatus(input.page, input.fixture, "modal"),
    "assertion"
  );

  await runReservationHistoryNavigationPair({
    action: () =>
      input.page.goBack({
        timeout: workspaceE2ETimeouts.browserNavigation,
        waitUntil: "load",
      }),
    actionStage: "history-back-action",
    page: input.page,
    url: urls.accountUrl,
    urlStage: "history-back-url",
  });
  await runReservationHistoryStage(
    "history-back-dialog",
    () => expect(input.page.getByRole("dialog")).toHaveCount(0),
    "assertion"
  );

  await runReservationHistoryNavigationPair({
    action: () =>
      input.page.goForward({
        timeout: workspaceE2ETimeouts.browserNavigation,
        waitUntil: "load",
      }),
    actionStage: "history-forward-action",
    page: input.page,
    url: urls.statusUrl,
    urlStage: "history-forward-url",
  });
  await runReservationHistoryStage(
    "history-forward-dialog",
    () => expect(input.page.getByRole("dialog")).toBeVisible(),
    "assertion"
  );
  await runReservationHistoryStage(
    "history-forward-content",
    () => expectFulfilledStatus(input.page, input.fixture, "modal"),
    "assertion"
  );

  await runReservationHistoryStage("details-reload", () =>
    input.page.reload({
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    })
  );
  await runReservationHistoryStage(
    "details-assert-dialog",
    () => expect(input.page.getByRole("dialog")).toHaveCount(0),
    "assertion"
  );
  await runReservationHistoryStage(
    "details-assert-content",
    () => expectFulfilledStatus(input.page, input.fixture, "page"),
    "assertion"
  );
  await runReservationHistoryStage("details-capture", () =>
    input.captureStatusReview("details")
  );

  const accessLink = input.page.locator("#checkout-status-access");
  await runReservationHistoryNavigationPair({
    action: () =>
      accessLink.click({ timeout: workspaceE2ETimeouts.browserAction }),
    actionStage: "access-open-click",
    page: input.page,
    url: urls.accessUrl,
    urlStage: "access-open-url",
  });
  await runReservationHistoryStage(
    "access-open-assert",
    () => expectUnavailableAccess(input.page),
    "assertion"
  );

  const reciprocalStatusLink = pageReservationLink(input.page, urls.statusPath);
  await runReservationHistoryStage(
    "access-details-return-link",
    () => expect(reciprocalStatusLink).toHaveCount(1),
    "assertion"
  );
  await runReservationHistoryStage("access-details-return-hydration", () =>
    waitForReservationStatusLinkHydration(input.page, urls.statusPath)
  );
  await runReservationHistoryNavigationPair({
    action: () =>
      reciprocalStatusLink.click({
        timeout: workspaceE2ETimeouts.browserAction,
      }),
    actionStage: "access-details-return-click",
    page: input.page,
    url: urls.statusUrl,
    urlStage: "access-details-return-url",
  });
  await runReservationHistoryStage(
    "access-details-return-dialog",
    () => expect(input.page.getByRole("dialog")).toHaveCount(0),
    "assertion"
  );
  await runReservationHistoryStage(
    "access-details-return-content",
    () => expectFulfilledStatus(input.page, input.fixture, "page"),
    "assertion"
  );

  await runReservationHistoryStage("history-final-load", () =>
    input.page.goto(urls.accountUrl, {
      timeout: workspaceE2ETimeouts.browserNavigation,
      waitUntil: "load",
    })
  );
  await runReservationHistoryStage(
    "history-final-link",
    () =>
      expect(pageReservationLink(input.page, urls.statusPath)).toHaveCount(1),
    "assertion"
  );
  await verifyPrivateRoutes(input, urls);
};

const pageReservationLink = (page: Page, statusPath: string) =>
  page.locator(`a[href="${statusPath}"]`);
