import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { workspaceDir } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

export type AccountReviewTarget =
  | "completion-mobile375x900"
  | "account-loading-desktop"
  | "callback-loading-desktop"
  | "sign-in-handoff-desktop"
  | "linked-reservations-desktop"
  | "linked-profile-desktop"
  | "linked-billing-desktop"
  | "linked-legal-desktop"
  | "public-legal-desktop"
  | "public-legal-mobile"
  | "linked-danger-desktop"
  | "support-desktop"
  | "sign-in-accepted-desktop"
  | "sign-in-pending-desktop"
  | "sign-in-desktop"
  | "callback-failed-desktop"
  | "deleted-desktop";

export type ReservationStatusReviewTarget =
  | "reservation-status-modal-desktop"
  | "reservation-status-details-desktop";

type AccountReviewTargetMetadata = {
  readonly filename: `${string}.png`;
  readonly fullPage?: boolean;
  readonly path: string | readonly string[];
  readonly viewport: Playwright.ViewportSize;
};

type ReviewTarget = AccountReviewTarget | ReservationStatusReviewTarget;

type ReservationStatusReviewMetadata = Omit<
  AccountReviewTargetMetadata,
  "path"
>;

const accountReviewTargetMetadata = {
  "completion-mobile375x900": {
    filename: "completion-mobile375x900.png",
    path: "/en-US/account",
    viewport: { height: 900, width: 375 },
  },
  "account-loading-desktop": {
    filename: "account-loading-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "callback-loading-desktop": {
    filename: "callback-loading-desktop.png",
    path: "/en-US/auth/callback",
    viewport: { height: 1000, width: 1440 },
  },
  "sign-in-handoff-desktop": {
    filename: "sign-in-handoff-desktop.png",
    path: ["/en-US/account", "/en-US/auth/sign-in"],
    viewport: { height: 1000, width: 1440 },
  },
  "linked-reservations-desktop": {
    filename: "linked-reservations-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-desktop": {
    filename: "linked-profile-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-billing-desktop": {
    filename: "linked-billing-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-legal-desktop": {
    filename: "linked-legal-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "public-legal-desktop": {
    filename: "public-legal-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "public-legal-mobile": {
    filename: "public-legal-mobile.png",
    path: "/en-US/account/legal",
    viewport: { height: 900, width: 375 },
  },
  "linked-danger-desktop": {
    filename: "linked-danger-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "support-desktop": {
    filename: "support-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "sign-in-accepted-desktop": {
    filename: "sign-in-accepted-desktop.png",
    path: "/en-US/auth/sign-in",
    viewport: { height: 1000, width: 1440 },
  },
  "sign-in-pending-desktop": {
    filename: "sign-in-pending-desktop.png",
    path: "/en-US/auth/sign-in",
    viewport: { height: 1000, width: 1440 },
  },
  "sign-in-desktop": {
    filename: "sign-in-desktop.png",
    path: "/en-US/auth/sign-in",
    viewport: { height: 1000, width: 1440 },
  },
  "callback-failed-desktop": {
    filename: "callback-failed-desktop.png",
    path: "/en-US/auth/callback",
    viewport: { height: 1000, width: 1440 },
  },
  "deleted-desktop": {
    filename: "deleted-desktop.png",
    path: "/en-US/account/deleted",
    viewport: { height: 1000, width: 1440 },
  },
} as const satisfies Record<AccountReviewTarget, AccountReviewTargetMetadata>;

const reservationStatusReviewMetadata = {
  "reservation-status-modal-desktop": {
    filename: "reservation-status-modal-desktop.png",
    viewport: { height: 1000, width: 1440 },
  },
  "reservation-status-details-desktop": {
    filename: "reservation-status-details-desktop.png",
    viewport: { height: 1000, width: 1440 },
  },
} as const satisfies Record<
  ReservationStatusReviewTarget,
  ReservationStatusReviewMetadata
>;
const reservationStatusPathPrefix = `/en-US${reservationStatusPath}`;

const accountReviewArtifactDirectory = resolve(
  workspaceDir,
  "e2e-artifacts",
  "account-review"
);
const accountReviewCaptureFailureMessage =
  "Account review screenshot capture failed";

const accountReviewCaptureFailure = () =>
  new Error(accountReviewCaptureFailureMessage);

const callbackLoadingName = "Loading sign-in…";
const callbackLoadingSelector =
  '[data-slot="auth-callback-loading"][role="status"][aria-busy="true"]';
const privateLinkedAccountSections = [
  "reservations",
  "profile",
  "billing",
  "danger",
] as const;

const isPrivateLinkedAccountTarget = (target: ReviewTarget): boolean =>
  target === "linked-reservations-desktop" ||
  target === "linked-profile-desktop" ||
  target === "linked-billing-desktop" ||
  target === "linked-danger-desktop";

const isAllowedPrivateLinkedAccountQuery = (search: string): boolean =>
  search === "" ||
  privateLinkedAccountSections.some(
    (section) => search === `?section=${section}`
  );

type AccountReviewCaptureOptions = {
  readonly deadline?: number;
  readonly signal?: AbortSignal;
};

const remainingAccountReviewBudget = (deadline: number): number => {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw accountReviewCaptureFailure();
  return remaining;
};

const throwIfAccountReviewAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted) throw accountReviewCaptureFailure();
};

const waitForAccountReviewOperation = async <A>(
  operation: () => Promise<A>,
  deadline: number,
  signal?: AbortSignal
): Promise<A> => {
  throwIfAccountReviewAborted(signal);
  const timeout = remainingAccountReviewBudget(deadline);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(accountReviewCaptureFailure()),
      timeout
    );
  });
  const abortPromise = signal
    ? new Promise<never>((_, reject) => {
        abort = () => reject(accountReviewCaptureFailure());
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      })
    : undefined;
  const operationPromise = Promise.resolve().then(() => {
    throwIfAccountReviewAborted(signal);
    return operation();
  });
  const races: Promise<A>[] = [operationPromise, timeoutPromise];
  if (abortPromise) races.push(abortPromise);

  try {
    const result = await Promise.race(races);
    throwIfAccountReviewAborted(signal);
    remainingAccountReviewBudget(deadline);
    return result;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abort && signal) signal.removeEventListener("abort", abort);
  }
};

const validateAccountReviewPage = (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata
): void => {
  let pageUrl: URL;
  let base: URL;
  try {
    pageUrl = new URL(page.url());
    base = new URL(baseUrl);
  } catch {
    throw accountReviewCaptureFailure();
  }

  const queryIsAllowed =
    (isPrivateLinkedAccountTarget(target) &&
      isAllowedPrivateLinkedAccountQuery(pageUrl.search)) ||
    (!isPrivateLinkedAccountTarget(target) && pageUrl.search === "") ||
    (target === "callback-failed-desktop" &&
      pageUrl.search === "?error=INVALID_TOKEN");
  const allowedPaths =
    typeof metadata.path === "string" ? [metadata.path] : metadata.path;
  if (
    pageUrl.origin !== base.origin ||
    !allowedPaths.includes(pageUrl.pathname) ||
    !queryIsAllowed ||
    pageUrl.hash !== ""
  ) {
    throw accountReviewCaptureFailure();
  }
};

const captureAccountReviewPixels = async (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata,
  deadline: number,
  signal?: AbortSignal
): Promise<Buffer> => {
  validateAccountReviewPage(page, baseUrl, target, metadata);
  throwIfAccountReviewAborted(signal);
  await waitForDocumentFonts(page, deadline, signal);
  throwIfAccountReviewAborted(signal);
  validateAccountReviewPage(page, baseUrl, target, metadata);
  const screenshotTimeout = remainingAccountReviewBudget(deadline);
  // Playwright cannot cancel an already-started screenshot; the signal race
  // only prevents a cancelled preparation from starting a new one.
  const screenshot = await waitForAccountReviewOperation(
    () =>
      page.screenshot({
        animations: "disabled",
        fullPage: metadata.fullPage ?? true,
        timeout: screenshotTimeout,
      }),
    deadline,
    signal
  );
  remainingAccountReviewBudget(deadline);
  return screenshot;
};

const validateCallbackLoadingCapture = async (
  page: Playwright.Page,
  deadline: number,
  signal?: AbortSignal
): Promise<void> => {
  const main = page.locator("main");
  const loadingCard = page.locator(callbackLoadingSelector);
  const loadingStatus = page.getByRole("status", {
    exact: true,
    name: callbackLoadingName,
  });
  const loadingText = loadingCard.getByText(callbackLoadingName, {
    exact: true,
  });

  await waitForAccountReviewOperation(
    () =>
      loadingCard.waitFor({
        state: "visible",
        timeout: remainingAccountReviewBudget(deadline),
      }),
    deadline,
    signal
  );
  if (
    (await waitForAccountReviewOperation(
      () => loadingCard.count(),
      deadline,
      signal
    )) !== 1
  )
    throw accountReviewCaptureFailure();
  await waitForAccountReviewOperation(
    () =>
      loadingStatus.waitFor({
        state: "visible",
        timeout: remainingAccountReviewBudget(deadline),
      }),
    deadline,
    signal
  );
  await waitForAccountReviewOperation(
    () =>
      loadingText.waitFor({
        state: "visible",
        timeout: remainingAccountReviewBudget(deadline),
      }),
    deadline,
    signal
  );
  const mainBox = await waitForAccountReviewOperation(
    () => main.boundingBox({ timeout: remainingAccountReviewBudget(deadline) }),
    deadline,
    signal
  );
  if (!mainBox || mainBox.width <= 0 || mainBox.height <= 0)
    throw accountReviewCaptureFailure();
  throwIfAccountReviewAborted(signal);
  remainingAccountReviewBudget(deadline);
};

const persistAccountReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata,
  screenshot: Buffer,
  deadline: number,
  signal?: AbortSignal
): Promise<void> => {
  const validateBeforeWrite = async () => {
    throwIfAccountReviewAborted(signal);
    remainingAccountReviewBudget(deadline);
    validateAccountReviewPage(page, baseUrl, target, metadata);
    if (target === "callback-loading-desktop")
      await validateCallbackLoadingCapture(page, deadline, signal);
    throwIfAccountReviewAborted(signal);
    remainingAccountReviewBudget(deadline);
  };

  await validateBeforeWrite();
  await waitForAccountReviewOperation(
    () => fsPromises.mkdir(accountReviewArtifactDirectory, { recursive: true }),
    deadline,
    signal
  );
  await validateBeforeWrite();
  await waitForAccountReviewOperation(
    () =>
      fsPromises.writeFile(
        resolve(accountReviewArtifactDirectory, metadata.filename),
        screenshot
      ),
    deadline,
    signal
  );
  remainingAccountReviewBudget(deadline);
};

/**
 * Callers own the synthetic browser context and account state. This helper only
 * emits the explicitly requested PNG; it creates no browser, auth, database,
 * cookie, trace, HAR, or logging state.
 */
const captureAccountReviewWithMetadata = async (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata,
  options: AccountReviewCaptureOptions = {}
): Promise<void> => {
  const deadline =
    options.deadline ?? Date.now() + workspaceE2ETimeouts.browserAction;
  validateAccountReviewPage(page, baseUrl, target, metadata);

  let previousViewport: Playwright.ViewportSize | null;
  try {
    previousViewport = page.viewportSize();
  } catch {
    throw accountReviewCaptureFailure();
  }
  if (previousViewport === null) throw accountReviewCaptureFailure();

  let captureFailed = false;
  try {
    await waitForAccountReviewOperation(
      () => page.setViewportSize(metadata.viewport),
      deadline,
      options.signal
    );
    const screenshot = await captureAccountReviewPixels(
      page,
      baseUrl,
      target,
      metadata,
      deadline,
      options.signal
    );
    await persistAccountReview(
      page,
      baseUrl,
      target,
      metadata,
      screenshot,
      deadline,
      options.signal
    );
  } catch {
    captureFailed = true;
  } finally {
    try {
      const cleanupDeadline = Date.now() + workspaceE2ETimeouts.cleanupAction;
      await waitForAccountReviewOperation(
        () => page.setViewportSize(previousViewport),
        cleanupDeadline
      );
    } catch {
      captureFailed = true;
    }
  }

  if (captureFailed) throw accountReviewCaptureFailure();
};

export const captureAccountReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: AccountReviewTarget,
  options: AccountReviewCaptureOptions = {}
): Promise<void> => {
  const metadata = accountReviewTargetMetadata[target];
  if (!metadata) throw accountReviewCaptureFailure();
  await captureAccountReviewWithMetadata(
    page,
    baseUrl,
    target,
    metadata,
    options
  );
};

export const captureReservationStatusReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: ReservationStatusReviewTarget,
  reservationId: WorkspaceReservationId,
  options: AccountReviewCaptureOptions = {}
): Promise<void> => {
  const metadata = reservationStatusReviewMetadata[target];
  if (!metadata) throw accountReviewCaptureFailure();

  await captureAccountReviewWithMetadata(
    page,
    baseUrl,
    target,
    {
      ...metadata,
      path: `${reservationStatusPathPrefix}/${encodeURIComponent(reservationId)}`,
    },
    options
  );
};

const waitForDocumentFonts = async (
  page: Playwright.Page,
  deadline: number,
  signal?: AbortSignal
): Promise<void> => {
  await waitForAccountReviewOperation(
    () => page.evaluate(() => document.fonts.ready.then(() => undefined)),
    deadline,
    signal
  );
};

export const withSignInPendingReview = async (
  page: Playwright.Page,
  baseUrl: string,
  runCase: () => Promise<void>
): Promise<void> => {
  const pendingMetadata =
    accountReviewTargetMetadata["sign-in-pending-desktop"];
  let fullHandlerPromise: Promise<void> | undefined;
  let reviewFailed = false;
  let runCaseFailed = false;
  let runCaseFailure: unknown;
  let wrapperFailed = false;
  let previousViewport: Playwright.ViewportSize | null = null;
  let routeCleanupOwed = false;
  let magicLinkUrl = "";
  let cleanupDeadline: number | undefined;
  const beginCleanup = () => {
    cleanupDeadline ??= Date.now() + workspaceE2ETimeouts.cleanupAction;
    return cleanupDeadline;
  };
  const handleMagicLinkRoute: Parameters<Playwright.Page["route"]>[1] = (
    route,
    request
  ) => {
    const deadline = Date.now() + workspaceE2ETimeouts.browserAction;
    const handlerPromise = (async () => {
      try {
        if (request.method() !== "POST") {
          reviewFailed = true;
          return;
        }
        await page.locator("#account-sign-in-submit[aria-busy=true]").waitFor({
          state: "visible",
          timeout: remainingAccountReviewBudget(deadline),
        });
        remainingAccountReviewBudget(deadline);
        const screenshot = await captureAccountReviewPixels(
          page,
          baseUrl,
          "sign-in-pending-desktop",
          pendingMetadata,
          deadline
        );
        await persistAccountReview(
          page,
          baseUrl,
          "sign-in-pending-desktop",
          pendingMetadata,
          screenshot,
          deadline
        );
      } catch {
        reviewFailed = true;
      } finally {
        try {
          await route.continue();
        } catch {
          reviewFailed = true;
        }
      }
    })();
    fullHandlerPromise = handlerPromise;
    return handlerPromise;
  };

  try {
    previousViewport = page.viewportSize();
    if (previousViewport === null) throw accountReviewCaptureFailure();
    await waitForAccountReviewOperation(
      () => page.setViewportSize(pendingMetadata.viewport),
      Date.now() + workspaceE2ETimeouts.browserAction
    );
    magicLinkUrl = new URL("/api/auth/sign-in/magic-link", baseUrl).toString();
    routeCleanupOwed = true;
    await waitForAccountReviewOperation(
      () => page.route(magicLinkUrl, handleMagicLinkRoute, { times: 1 }),
      Date.now() + workspaceE2ETimeouts.browserAction
    );
    try {
      await runCase();
    } catch (cause) {
      runCaseFailed = true;
      runCaseFailure = cause;
    }
  } catch {
    wrapperFailed = true;
  } finally {
    const sharedCleanupDeadline = beginCleanup();
    if (routeCleanupOwed) {
      try {
        await waitForAccountReviewOperation(
          () => page.unroute(magicLinkUrl, handleMagicLinkRoute),
          sharedCleanupDeadline
        );
      } catch {
        wrapperFailed = true;
      }
      if (fullHandlerPromise) {
        try {
          await waitForAccountReviewOperation(
            () => fullHandlerPromise as Promise<void>,
            sharedCleanupDeadline
          );
        } catch {
          wrapperFailed = true;
        }
      } else {
        reviewFailed = true;
      }
    }
    if (previousViewport !== null) {
      const viewportToRestore = previousViewport;
      try {
        await waitForAccountReviewOperation(
          () => page.setViewportSize(viewportToRestore),
          sharedCleanupDeadline
        );
      } catch {
        wrapperFailed = true;
      }
    }
  }

  if (runCaseFailed) throw runCaseFailure;
  if (wrapperFailed || reviewFailed || !fullHandlerPromise)
    throw accountReviewCaptureFailure();
};
