import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import {
  getAccountPath,
  getAccountSectionPath,
} from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { workspaceDir } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  isCallbackFailureQuery,
  isExactCallbackUrlString,
} from "./callback-url";
import {
  type LanguagePreferenceReviewStage,
  languagePreferenceReviewTargetByStage,
} from "./review-targets";

export type AccountReviewTarget =
  | "completion-mobile375x900"
  | "account-loading-desktop"
  | "callback-loading-desktop"
  | "sign-in-handoff-desktop"
  | "linked-reservations-desktop"
  | "linked-reservations-mobile"
  | "linked-referrals-desktop"
  | "linked-referrals-mobile"
  | "linked-referrals-cs-desktop"
  | "linked-referrals-cs-mobile"
  | "referral-overview-positive-desktop"
  | "referral-overview-positive-mobile"
  | "referral-overview-positive-cs-desktop"
  | "referral-overview-positive-cs-mobile"
  | "linked-profile-desktop"
  | "linked-profile-language-desktop"
  | "linked-profile-language-desktop-cs"
  | "linked-profile-language-mobile"
  | "locale-preference-redirect-desktop"
  | "locale-switcher-saved-desktop"
  | "linked-security-desktop"
  | "linked-billing-desktop"
  | "linked-billing-mobile"
  | "linked-legal-desktop"
  | "reservation-customer-account-desktop"
  | "reservation-customer-contact-desktop"
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

const enAccountPath = getAccountPath("en-US");
const enAccountSectionPath = (section: AccountSection) =>
  getAccountSectionPath("en-US", section);
const csAccountSectionPath = (section: AccountSection) =>
  getAccountSectionPath("cs-CZ", section);

const accountReviewTargetMetadata = {
  "completion-mobile375x900": {
    filename: "completion-mobile375x900.png",
    path: enAccountPath,
    viewport: { height: 900, width: 375 },
  },
  "account-loading-desktop": {
    filename: "account-loading-desktop.png",
    path: enAccountPath,
    viewport: { height: 1000, width: 1440 },
  },
  "callback-loading-desktop": {
    filename: "callback-loading-desktop.png",
    path: "/en-US/auth/callback",
    viewport: { height: 1000, width: 1440 },
  },
  "sign-in-handoff-desktop": {
    filename: "sign-in-handoff-desktop.png",
    path: [enAccountPath, "/en-US/auth/sign-in"],
    viewport: { height: 1000, width: 1440 },
  },
  "linked-reservations-desktop": {
    filename: "linked-reservations-desktop.png",
    path: enAccountSectionPath("reservations"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-reservations-mobile": {
    filename: "linked-reservations-mobile.png",
    path: enAccountSectionPath("reservations"),
    viewport: { height: 900, width: 375 },
  },
  "linked-referrals-desktop": {
    filename: "linked-referrals-desktop.png",
    path: enAccountSectionPath("referrals"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-referrals-mobile": {
    filename: "linked-referrals-mobile.png",
    path: enAccountSectionPath("referrals"),
    viewport: { height: 900, width: 375 },
  },
  "linked-referrals-cs-desktop": {
    filename: "linked-referrals-cs-desktop.png",
    path: csAccountSectionPath("referrals"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-referrals-cs-mobile": {
    filename: "linked-referrals-cs-mobile.png",
    path: csAccountSectionPath("referrals"),
    viewport: { height: 900, width: 375 },
  },
  "referral-overview-positive-desktop": {
    filename: "referral-overview-positive-desktop.png",
    path: enAccountSectionPath("referrals"),
    viewport: { height: 1000, width: 1440 },
  },
  "referral-overview-positive-mobile": {
    filename: "referral-overview-positive-mobile.png",
    path: enAccountSectionPath("referrals"),
    viewport: { height: 900, width: 375 },
  },
  "referral-overview-positive-cs-desktop": {
    filename: "referral-overview-positive-cs-desktop.png",
    path: csAccountSectionPath("referrals"),
    viewport: { height: 1000, width: 1440 },
  },
  "referral-overview-positive-cs-mobile": {
    filename: "referral-overview-positive-cs-mobile.png",
    path: csAccountSectionPath("referrals"),
    viewport: { height: 900, width: 375 },
  },
  "linked-profile-desktop": {
    filename: "linked-profile-desktop.png",
    path: enAccountSectionPath("profile"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-desktop": {
    filename: "linked-profile-language-desktop.png",
    path: enAccountSectionPath("profile"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-desktop-cs": {
    filename: "linked-profile-language-desktop-cs.png",
    path: csAccountSectionPath("profile"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-profile-language-mobile": {
    filename: "linked-profile-language-mobile.png",
    path: enAccountSectionPath("profile"),
    viewport: { height: 900, width: 375 },
  },
  "locale-preference-redirect-desktop": {
    filename: "locale-preference-redirect-desktop.png",
    path: "/cs-CZ/faq",
    viewport: { height: 1000, width: 1440 },
  },
  "locale-switcher-saved-desktop": {
    filename: "locale-switcher-saved-desktop.png",
    path: enAccountPath,
    viewport: { height: 1000, width: 1440 },
  },
  "linked-billing-desktop": {
    filename: "linked-billing-desktop.png",
    path: enAccountSectionPath("billing"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-billing-mobile": {
    filename: "linked-billing-mobile.png",
    path: enAccountSectionPath("billing"),
    viewport: { height: 900, width: 375 },
  },
  "linked-legal-desktop": {
    filename: "linked-legal-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "reservation-customer-account-desktop": {
    filename: "reservation-customer-account-desktop.png",
    path: "/en-US/reservation/cowork",
    viewport: { height: 1000, width: 1440 },
  },
  "reservation-customer-contact-desktop": {
    filename: "reservation-customer-contact-desktop.png",
    path: "/en-US/reservation/cowork",
    viewport: { height: 1000, width: 1440 },
  },
  "account-marketing-withdrawn-desktop": {
    filename: "account-marketing-withdrawn-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "account-marketing-active-mobile": {
    filename: "account-marketing-active-mobile.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-pending-desktop": {
    filename: "marketing-link-pending-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-pending-mobile": {
    filename: "marketing-link-pending-mobile.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-active-desktop": {
    filename: "marketing-link-active-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-active-mobile": {
    filename: "marketing-link-active-mobile.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-withdrawn-desktop": {
    filename: "marketing-link-withdrawn-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-withdrawn-mobile": {
    filename: "marketing-link-withdrawn-mobile.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 900, width: 375 },
  },
  "marketing-link-invalid-desktop": {
    filename: "marketing-link-invalid-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "marketing-link-invalid-mobile": {
    filename: "marketing-link-invalid-mobile.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 900, width: 375 },
  },
  "public-legal-desktop": {
    filename: "public-legal-desktop.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 1000, width: 1440 },
  },
  "public-legal-mobile": {
    filename: "public-legal-mobile.png",
    path: enAccountSectionPath("legal"),
    viewport: { height: 900, width: 375 },
  },
  "linked-security-desktop": {
    filename: "linked-security-desktop.png",
    path: enAccountSectionPath("security"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-danger-desktop": {
    filename: "linked-danger-desktop.png",
    path: enAccountSectionPath("danger"),
    viewport: { height: 1000, width: 1440 },
  },
  "linked-danger-mobile": {
    filename: "linked-danger-mobile.png",
    path: enAccountSectionPath("danger"),
    viewport: { height: 900, width: 375 },
  },
  "support-desktop": {
    filename: "support-desktop.png",
    path: enAccountPath,
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
const referralReviewTargets = new Set<ReviewTarget>([
  "linked-referrals-desktop",
  "linked-referrals-mobile",
  "linked-referrals-cs-desktop",
  "linked-referrals-cs-mobile",
  "referral-overview-positive-desktop",
  "referral-overview-positive-mobile",
  "referral-overview-positive-cs-desktop",
  "referral-overview-positive-cs-mobile",
]);

type AccountReviewCaptureOptions = {
  readonly deadline?: number;
  readonly signal?: AbortSignal;
};

/**
 * The preview a review screenshot is taken from, and whether this run captures
 * review screenshots at all (decoded once by the E2E environment boundary).
 */
export type AccountReviewDestination = {
  readonly baseUrl: string;
  readonly screenshots: boolean;
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
    pageUrl.search === "" ||
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
        ...(referralReviewTargets.has(target)
          ? {
              mask: [
                page.locator(
                  '[data-screen="referrals-screen"] code, [data-screen="referrals-screen"] a[href*="ref="]'
                ),
              ],
            }
          : {}),
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
  const loadingSkeleton = loadingCard.locator('[data-slot="skeleton"]').first();

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
      loadingSkeleton.waitFor({
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
 * cookie, trace, HAR, or logging state. The public capture helpers return
 * before touching the page or the artifact directory when the destination does
 * not capture review screenshots.
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
  { baseUrl, screenshots }: AccountReviewDestination,
  pixels: Buffer,
  validate: () => void,
  options: {
    readonly deadline?: number;
    readonly signal?: AbortSignal;
  } = {}
): Promise<void> => {
  if (!screenshots) return;
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
  { baseUrl, screenshots }: AccountReviewDestination,
  target: AccountReviewTarget,
  options: AccountReviewCaptureOptions = {}
): Promise<void> => {
  if (!screenshots) return;
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
  { baseUrl, screenshots }: AccountReviewDestination,
  target: ReservationStatusReviewTarget,
  reservationId: WorkspaceReservationId,
  options: AccountReviewCaptureOptions = {}
): Promise<void> => {
  if (!screenshots) return;
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

/**
 * Holds the sign-in POST only to photograph the pending form, so without the
 * review screenshot opt-in the case runs unwrapped.
 */
export const withSignInPendingReview = async (
  page: Playwright.Page,
  { baseUrl, screenshots }: AccountReviewDestination,
  runCase: () => Promise<void>
): Promise<void> => {
  if (!screenshots) return runCase();
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
 * Captures the review target of one mid-case language moment. It never
 * throws: a failed or repeated capture is recorded by the wrapper, which
 * reports it only after the case has finished.
 */
export type LanguagePreferenceReviewCapture = (
  stage: LanguagePreferenceReviewStage
) => Promise<void>;

const skipLanguagePreferenceReview: LanguagePreferenceReviewCapture =
  async () => undefined;

/**
 * Hands the language case its review capture hook. The case photographs its
 * genuine mid-case moments: the Czech profile after the profile control moved
 * the site to Czech, the Czech page a conflicting en-US URL and cookie were
 * redirected to, and the English account page the header switch moved the
 * preference to. After the case ends on the English profile, the mobile
 * language view is captured. Choosing a language saves it and navigates at
 * once, so there is no separate saving, saved, or failed state to hold or
 * photograph. Callers own the synthetic context; this helper only captures
 * the allowlisted PNGs.
 */
export const withLanguagePreferenceReview = async (
  page: Playwright.Page,
  review: AccountReviewDestination,
  runCase: (capture: LanguagePreferenceReviewCapture) => Promise<void>
): Promise<void> => {
  if (!review.screenshots) return runCase(skipLanguagePreferenceReview);

  let reviewFailed = false;
  const capturedStages = new Set<LanguagePreferenceReviewStage>();

  const captureStage: LanguagePreferenceReviewCapture = async (stage) => {
    if (capturedStages.has(stage)) {
      reviewFailed = true;
      return;
    }
    capturedStages.add(stage);
    try {
      await captureAccountReview(
        page,
        review,
        languagePreferenceReviewTargetByStage[stage]
      );
    } catch {
      reviewFailed = true;
    }
  };

  // A case failure propagates as is and skips the post-case capture.
  await runCase(captureStage);

  if (
    Object.keys(languagePreferenceReviewTargetByStage).some(
      (stage) => !capturedStages.has(stage as LanguagePreferenceReviewStage)
    )
  ) {
    reviewFailed = true;
  }
  try {
    await captureAccountReview(page, review, "linked-profile-language-mobile");
  } catch {
    reviewFailed = true;
  }

  if (reviewFailed) throw accountReviewCaptureFailure();
};
