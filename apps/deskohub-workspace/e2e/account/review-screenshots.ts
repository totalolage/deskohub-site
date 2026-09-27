import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { workspaceDir } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  isCallbackFailureQuery,
  isExactCallbackUrlString,
} from "./callback-url";

export type AccountReviewTarget =
  | "completion-mobile375x900"
  | "account-loading-desktop"
  | "callback-loading-desktop"
  | "sign-in-handoff-desktop"
  | "linked-reservations-desktop"
  | "linked-reservations-mobile"
  | "linked-profile-desktop"
  | "linked-profile-language-desktop"
  | "linked-profile-language-desktop-cs"
  | "linked-profile-language-mobile"
  | "linked-profile-language-saving-desktop"
  | "linked-profile-language-saved-desktop"
  | "linked-profile-language-failed-desktop"
  | "linked-billing-desktop"
  | "linked-billing-mobile"
  | "linked-legal-desktop"
  | "account-marketing-withdrawn-desktop"
  | "account-marketing-active-mobile"
  | "marketing-link-pending-desktop"
  | "marketing-link-pending-mobile"
  | "marketing-link-active-desktop"
  | "marketing-link-active-mobile"
  | "marketing-link-withdrawn-desktop"
  | "marketing-link-withdrawn-mobile"
  | "marketing-link-invalid-desktop"
  | "marketing-link-invalid-mobile"
  | "public-legal-desktop"
  | "public-legal-mobile"
  | "linked-danger-desktop"
  | "linked-danger-mobile"
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
  "linked-reservations-mobile": {
    filename: "linked-reservations-mobile.png",
    path: "/en-US/account",
    viewport: { height: 900, width: 375 },
  },
  "linked-profile-desktop": {
    filename: "linked-profile-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-desktop": {
    filename: "linked-profile-language-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-desktop-cs": {
    filename: "linked-profile-language-desktop-cs.png",
    path: "/cs-CZ/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-mobile": {
    filename: "linked-profile-language-mobile.png",
    path: "/en-US/account",
    viewport: { height: 900, width: 375 },
  },
  "linked-profile-language-saving-desktop": {
    filename: "linked-profile-language-saving-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-saved-desktop": {
    filename: "linked-profile-language-saved-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-failed-desktop": {
    filename: "linked-profile-language-failed-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-billing-desktop": {
    filename: "linked-billing-desktop.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-billing-mobile": {
    filename: "linked-billing-mobile.png",
    path: "/en-US/account",
    viewport: { height: 900, width: 375 },
  },
  "linked-legal-desktop": {
    filename: "linked-legal-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "account-marketing-withdrawn-desktop": {
    filename: "account-marketing-withdrawn-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "account-marketing-active-mobile": {
    filename: "account-marketing-active-mobile.png",
    path: "/en-US/account/legal",
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-pending-desktop": {
    filename: "marketing-link-pending-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-pending-mobile": {
    filename: "marketing-link-pending-mobile.png",
    path: "/en-US/account/legal",
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-active-desktop": {
    filename: "marketing-link-active-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-active-mobile": {
    filename: "marketing-link-active-mobile.png",
    path: "/en-US/account/legal",
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-withdrawn-desktop": {
    filename: "marketing-link-withdrawn-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-withdrawn-mobile": {
    filename: "marketing-link-withdrawn-mobile.png",
    path: "/en-US/account/legal",
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-invalid-desktop": {
    filename: "marketing-link-invalid-desktop.png",
    path: "/en-US/account/legal",
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-invalid-mobile": {
    filename: "marketing-link-invalid-mobile.png",
    path: "/en-US/account/legal",
    viewport: { height: 900, width: 375 },
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
  "linked-danger-mobile": {
    filename: "linked-danger-mobile.png",
    path: "/en-US/account",
    viewport: { height: 900, width: 375 },
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
  target === "linked-reservations-mobile" ||
  target === "linked-profile-desktop" ||
  target === "linked-profile-language-desktop" ||
  target === "linked-profile-language-desktop-cs" ||
  target === "linked-profile-language-mobile" ||
  target === "linked-profile-language-saving-desktop" ||
  target === "linked-profile-language-saved-desktop" ||
  target === "linked-profile-language-failed-desktop" ||
  target === "linked-billing-desktop" ||
  target === "linked-billing-mobile" ||
  target === "linked-danger-desktop" ||
  target === "linked-danger-mobile";

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
    // The callback-loading capture reuses the shared callback URL grammar so a
    // canonical attempt parameter stays allowed; all other callback queries
    // keep failing closed.
    (target === "callback-loading-desktop" &&
      isExactCallbackUrlString(page.url(), base.origin)) ||
    (target === "callback-failed-desktop" &&
      isCallbackFailureQuery(pageUrl.search));
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

/**
 * A capture validator for the held callback document. The default validates
 * the loading landmarks through Playwright DOM operations; receipt-backed
 * callers supply the adapter validator instead.
 */
type CallbackCaptureValidator = (
  page: Playwright.Page,
  deadline: number,
  signal?: AbortSignal
) => Promise<void> | void;

const persistAccountReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata,
  screenshot: Buffer,
  deadline: number,
  signal?: AbortSignal,
  validateCallbackCapture: CallbackCaptureValidator = validateCallbackLoadingCapture
): Promise<void> => {
  const validateBeforeWrite = async () => {
    throwIfAccountReviewAborted(signal);
    remainingAccountReviewBudget(deadline);
    validateAccountReviewPage(page, baseUrl, target, metadata);
    if (target === "callback-loading-desktop") {
      try {
        await validateCallbackCapture(page, deadline, signal);
      } catch {
        throw accountReviewCaptureFailure();
      }
    }
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

/**
 * Persistence for the receipt-backed callback document review. The target is
 * fixed to the callback-loading-desktop review artifact; the caller supplies
 * the synchronous held-document validator, so no Playwright DOM operation runs
 * while the qualifying request is held. The shared URL checks and revalidation
 * before the mkdir/write still apply; there is no generic public bypass.
 */
export const persistCallbackDocumentReview = async (
  page: Playwright.Page,
  baseUrl: string,
  pixels: Buffer,
  validate: () => void,
  options: {
    readonly deadline?: number;
    readonly signal?: AbortSignal;
  } = {}
): Promise<void> => {
  const metadata = accountReviewTargetMetadata["callback-loading-desktop"];
  if (!metadata) throw accountReviewCaptureFailure();
  const deadline =
    options.deadline ?? Date.now() + workspaceE2ETimeouts.browserAction;
  await persistAccountReview(
    page,
    baseUrl,
    "callback-loading-desktop",
    metadata,
    pixels,
    deadline,
    options.signal,
    () => {
      validate();
    }
  );
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

/**
 * Deployed copy of the language feedback states the wrapper waits for; the
 * keys behind these strings (accountProfileScreenLanguageSaving/Saved/
 * SaveFailed) are pinned by the shared message catalogs.
 */
const languageSavingButtonSelector = 'button:has-text("Saving…")';
const languageTriggerSelector =
  "[data-screen='profile-screen'] [data-slot='select-trigger']";
const languageSaveButtonSelector =
  "[data-screen='profile-screen'] button:has-text('Save')";
const languageOptionEnSelector = '[role="option"]:has-text("English (US)")';
const languageSavedCopy = "Communication language saved.";
const languageFailedCopy =
  "Saving the communication language failed. Try again.";
const profileScreenSelector = "[data-screen='profile-screen']";
const csCzProfileNavButtonSelector =
  'nav[aria-label="Navigace účtu"] button:not([data-account-section]):has-text("Profil a identita")';
const enUsProfileNavButtonSelector =
  'nav[aria-label="Account navigation"] button:not([data-account-section]):has-text("Profile & Identity")';

const browserActionTimeout = () => workspaceE2ETimeouts.browserAction;

/**
 * Drives the preferred-communication-language feature's own review states
 * around the language case: the mid-flight saving feedback captured while
 * the case's own save request is in flight, the saved feedback, an
 * abort-induced transport failure restored by a real save, the cs-CZ
 * selector view, and the mobile view. Callers own the synthetic context;
 * this helper only captures the allowlisted PNGs and never changes the
 * persisted language preference.
 */
export const withLanguagePreferenceReview = async (
  page: Playwright.Page,
  baseUrl: string,
  runCase: () => Promise<void>
): Promise<void> => {
  const savingMetadata =
    accountReviewTargetMetadata["linked-profile-language-saving-desktop"];
  if (!savingMetadata) throw accountReviewCaptureFailure();
  const saveActionUrl = new URL("/en-US/account", baseUrl).toString();

  let savingHandlerPromise: Promise<void> | undefined;
  let savingRouteMatched = false;
  let abortRouteCleanupOwed = false;
  let reviewFailed = false;
  let runCaseFailed = false;
  let runCaseFailure: unknown;
  let wrapperFailed = false;
  let previousViewport: Playwright.ViewportSize | null = null;

  // The language save and the sign-out are both Server Action POSTs to the
  // account URL, so the saving route gates on the action argument carrying
  // the locale payload before it waits for the saving feedback. A gate miss
  // fails closed through savingRouteMatched below.
  const localeActionBody = (request: Playwright.Request): boolean => {
    const body = request.postData() ?? "";
    return body.includes("locale") || body.includes("en-US");
  };

  const handleSavingRoute: Parameters<Playwright.Page["route"]>[1] = (
    route,
    request
  ) => {
    const deadline = Date.now() + browserActionTimeout();
    const handlerPromise = (async () => {
      try {
        if (request.method() !== "POST" || !localeActionBody(request)) return;
        savingRouteMatched = true;
        await page.locator(languageSavingButtonSelector).waitFor({
          state: "visible",
          timeout: remainingAccountReviewBudget(deadline),
        });
        remainingAccountReviewBudget(deadline);
        const screenshot = await captureAccountReviewPixels(
          page,
          baseUrl,
          "linked-profile-language-saving-desktop",
          savingMetadata,
          deadline
        );
        await persistAccountReview(
          page,
          baseUrl,
          "linked-profile-language-saving-desktop",
          savingMetadata,
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
    savingHandlerPromise = handlerPromise;
    return handlerPromise;
  };

  const handleAbortRoute: Parameters<Playwright.Page["route"]>[1] = (
    route,
    request
  ) => {
    if (request.method() !== "POST") {
      void route.continue().catch(() => {
        reviewFailed = true;
      });
      return;
    }
    void route.abort().catch(() => {
      reviewFailed = true;
    });
  };

  const selectEnglishAndSave = async () => {
    await page
      .locator(languageTriggerSelector)
      .click({ timeout: browserActionTimeout() });
    await page
      .locator(languageOptionEnSelector)
      .click({ timeout: browserActionTimeout() });
    await page
      .locator(languageSaveButtonSelector)
      .click({ timeout: browserActionTimeout() });
  };

  const performSavedFeedbackCapture = async () => {
    await selectEnglishAndSave();
    await page
      .getByText(languageSavedCopy, { exact: true })
      .waitFor({ state: "visible", timeout: browserActionTimeout() });
    await captureAccountReview(
      page,
      baseUrl,
      "linked-profile-language-saved-desktop"
    );
  };

  const performTransportFailureCapture = async () => {
    await page.route(saveActionUrl, handleAbortRoute, { times: 1 });
    abortRouteCleanupOwed = true;
    await page
      .locator(languageSaveButtonSelector)
      .click({ timeout: browserActionTimeout() });
    await page
      .getByText(languageFailedCopy, { exact: true })
      .waitFor({ state: "visible", timeout: browserActionTimeout() });
    await captureAccountReview(
      page,
      baseUrl,
      "linked-profile-language-failed-desktop"
    );
  };

  const restoreSavedLanguage = async () => {
    await page.unroute(saveActionUrl, handleAbortRoute);
    abortRouteCleanupOwed = false;
    await page
      .locator(languageSaveButtonSelector)
      .click({ timeout: browserActionTimeout() });
    await page
      .getByText(languageSavedCopy, { exact: true })
      .waitFor({ state: "visible", timeout: browserActionTimeout() });
  };

  const performCsCzSelectorCapture = async () => {
    await page.goto(new URL("/cs-CZ/account", baseUrl).toString(), {
      timeout: browserActionTimeout(),
    });
    await page
      .locator(csCzProfileNavButtonSelector)
      .first()
      .click({ timeout: browserActionTimeout() });
    await page
      .locator(profileScreenSelector)
      .first()
      .waitFor({ state: "visible", timeout: browserActionTimeout() });
    await captureAccountReview(
      page,
      baseUrl,
      "linked-profile-language-desktop-cs"
    );
  };

  const returnToEnglishProfile = async () => {
    await page.goto(new URL("/en-US/account", baseUrl).toString(), {
      timeout: browserActionTimeout(),
    });
    await page
      .locator(enUsProfileNavButtonSelector)
      .first()
      .click({ timeout: browserActionTimeout() });
    await page
      .locator(profileScreenSelector)
      .first()
      .waitFor({ state: "visible", timeout: browserActionTimeout() });
  };

  try {
    previousViewport = page.viewportSize();
    if (previousViewport === null) throw accountReviewCaptureFailure();
    await waitForAccountReviewOperation(
      () => page.setViewportSize(savingMetadata.viewport),
      Date.now() + browserActionTimeout()
    );
    await waitForAccountReviewOperation(
      () => page.route(saveActionUrl, handleSavingRoute, { times: 1 }),
      Date.now() + browserActionTimeout()
    );
    try {
      await runCase();
    } catch (cause) {
      runCaseFailed = true;
      runCaseFailure = cause;
    }
  } catch {
    wrapperFailed = true;
  }

  if (!runCaseFailed && !wrapperFailed) {
    try {
      await performSavedFeedbackCapture();
      await performTransportFailureCapture();
      await restoreSavedLanguage();
      await performCsCzSelectorCapture();
      await returnToEnglishProfile();
      await captureAccountReview(
        page,
        baseUrl,
        "linked-profile-language-mobile"
      );
    } catch {
      reviewFailed = true;
    }
  }

  const cleanupDeadline = Date.now() + workspaceE2ETimeouts.cleanupAction;
  try {
    await waitForAccountReviewOperation(
      () => page.unroute(saveActionUrl, handleSavingRoute),
      cleanupDeadline
    );
  } catch {
    wrapperFailed = true;
  }
  if (abortRouteCleanupOwed) {
    try {
      await waitForAccountReviewOperation(
        () => page.unroute(saveActionUrl, handleAbortRoute),
        cleanupDeadline
      );
    } catch {
      wrapperFailed = true;
    }
  }
  if (savingHandlerPromise) {
    try {
      await waitForAccountReviewOperation(
        () => savingHandlerPromise as Promise<void>,
        cleanupDeadline
      );
    } catch {
      wrapperFailed = true;
    }
  } else {
    reviewFailed = true;
  }
  if (!runCaseFailed && !savingRouteMatched) reviewFailed = true;
  if (previousViewport !== null) {
    const viewportToRestore = previousViewport;
    try {
      await waitForAccountReviewOperation(
        () => page.setViewportSize(viewportToRestore),
        cleanupDeadline
      );
    } catch {
      wrapperFailed = true;
    }
  }

  if (runCaseFailed) throw runCaseFailure;
  if (wrapperFailed || reviewFailed || !savingHandlerPromise)
    throw accountReviewCaptureFailure();
};
