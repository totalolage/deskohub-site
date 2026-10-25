import * as fsPromises from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import {
  getAccountPath,
  getAccountSectionPath,
  signInReturnParam,
} from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { reservationStatusPath } from "@/features/reservation/routes";
import { parseSameOriginPath } from "@/shared/utils/same-origin-path";
import { workspaceDir } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type CallbackLanding,
  isCallbackFailureQuery,
  isExactCallbackUrlString,
  signedInCallbackCopy,
} from "./callback-url";
import {
  type LanguagePreferenceReviewStage,
  languagePreferenceReviewTargetByStage,
} from "./review-targets";

export type AccountReviewTarget =
  | "completion-mobile375x900"
  | "account-loading-desktop"
  | CallbackHandoffReviewTarget
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
  | "linked-assistants-desktop"
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
  | "sign-in-accepted-cs-desktop"
  | "sign-in-pending-desktop"
  | "sign-in-desktop"
  | "callback-failed-cs-desktop"
  | "deleted-desktop";

/**
 * The signed-in callback captures taken while the callback's hand-off request
 * is held: the English callback leaving for the account, and the Czech
 * callback returning to where the sign-in started.
 */
export type CallbackHandoffReviewTarget =
  | "callback-signed-in-desktop"
  | "callback-signed-in-cs-desktop";

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
  "callback-signed-in-desktop": {
    filename: "callback-signed-in-desktop.png",
    path: "/en-US/auth/callback",
    viewport: { height: 1000, width: 1440 },
  },
  "callback-signed-in-cs-desktop": {
    filename: "callback-signed-in-cs-desktop.png",
    path: "/cs-CZ/auth/callback",
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
  "linked-assistants-desktop": {
    filename: "linked-assistants-desktop.png",
    path: enAccountSectionPath("assistants"),
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
  "sign-in-accepted-cs-desktop": {
    filename: "sign-in-accepted-cs-desktop.png",
    path: "/cs-CZ/auth/sign-in",
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
  "callback-failed-cs-desktop": {
    filename: "callback-failed-cs-desktop.png",
    path: "/cs-CZ/auth/callback",
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

const isCallbackHandoffReviewTarget = (
  target: ReviewTarget
): target is CallbackHandoffReviewTarget =>
  target === "callback-signed-in-desktop" ||
  target === "callback-signed-in-cs-desktop";

/**
 * The sign-in pages the lane photographs after opening them from a cowork
 * selection, so their URL carries its return target.
 */
const signInReturnReviewTargets = new Set<ReviewTarget>([
  "sign-in-accepted-desktop",
  "sign-in-accepted-cs-desktop",
  "sign-in-pending-desktop",
]);

const reservationCustomerReviewTargets = new Set<ReviewTarget>([
  "reservation-customer-account-desktop",
  "reservation-customer-contact-desktop",
]);

/** A sign-in query: exactly one `returnTo` naming a same-origin path. */
const isSignInReturnQuery = (search: string): boolean => {
  const entries = [...new URLSearchParams(search).entries()];
  return (
    entries.length === 1 &&
    entries[0]?.[0] === signInReturnParam &&
    parseSameOriginPath(entries[0][1]) !== undefined
  );
};

/** The reservation customer review is captured on the explicit contact step. */
const isReservationContactStepQuery = (search: string): boolean => {
  const entries = [...new URLSearchParams(search).entries()];
  return (
    entries.length === 1 &&
    entries[0]?.[0] === "step" &&
    entries[0]?.[1] === "contact"
  );
};

/**
 * The page URL must be the target's path on the preview origin, without a
 * fragment. A signed-in callback capture is allowed only the exact callback
 * grammar of its landing, so it fails closed without one; other targets allow
 * an empty query or their own query grammar.
 */
const validateAccountReviewPage = (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata,
  callbackLanding?: CallbackLanding
): void => {
  let pageUrl: URL;
  let base: URL;
  try {
    pageUrl = new URL(page.url());
    base = new URL(baseUrl);
  } catch {
    throw accountReviewCaptureFailure();
  }

  const queryIsAllowed = isCallbackHandoffReviewTarget(target)
    ? callbackLanding !== undefined &&
      isExactCallbackUrlString(page.url(), base.origin, callbackLanding)
    : pageUrl.search === "" ||
      (target === "callback-failed-cs-desktop" &&
        isCallbackFailureQuery(pageUrl.search)) ||
      (signInReturnReviewTargets.has(target) &&
        isSignInReturnQuery(pageUrl.search)) ||
      (reservationCustomerReviewTargets.has(target) &&
        isReservationContactStepQuery(pageUrl.search));
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
  signal?: AbortSignal,
  callbackLanding?: CallbackLanding
): Promise<Buffer> => {
  validateAccountReviewPage(page, baseUrl, target, metadata, callbackLanding);
  throwIfAccountReviewAborted(signal);
  await waitForDocumentFonts(page, deadline, signal);
  throwIfAccountReviewAborted(signal);
  validateAccountReviewPage(page, baseUrl, target, metadata, callbackLanding);
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

/** A Playwright operation bounded by the caller's deadline and abort signal. */
export type BoundedLocatorOperation = <A>(
  operation: (timeout: number) => Promise<A>
) => Promise<A>;

/**
 * Whether the callback card shows the signed-in copy of `landing`: exactly
 * one visible heading and one visible body paragraph, each with the exact
 * trimmed text of the landing's locale and return.
 */
export const showsSignedInCallbackCopy = async (
  card: Playwright.Locator,
  landing: CallbackLanding,
  bounded: BoundedLocatorOperation
): Promise<boolean> => {
  const copy = signedInCallbackCopy(landing);
  for (const [selector, text] of [
    ["h1", copy.title],
    ["p", copy.body],
  ] as const) {
    const nodes = card.locator(selector);
    await bounded((timeout) =>
      nodes.first().waitFor({ state: "visible", timeout })
    );
    if ((await bounded(() => nodes.count())) !== 1) return false;
    const content = await bounded((timeout) => nodes.textContent({ timeout }));
    if (content?.trim() !== text) return false;
  }
  return true;
};

const validateSignedInCallbackCapture = async (
  page: Playwright.Page,
  landing: CallbackLanding,
  deadline: number,
  signal?: AbortSignal
): Promise<void> => {
  const bounded: BoundedLocatorOperation = (operation) =>
    waitForAccountReviewOperation(
      () => operation(remainingAccountReviewBudget(deadline)),
      deadline,
      signal
    );
  const main = page.locator("main");
  const loadingCard = page.locator(callbackLoadingSelector);
  const loadingStatus = page.getByRole("status", {
    exact: true,
    name: signedInCallbackCopy(landing).label,
  });

  await bounded((timeout) =>
    loadingCard.waitFor({ state: "visible", timeout })
  );
  if ((await bounded(() => loadingCard.count())) !== 1)
    throw accountReviewCaptureFailure();
  await bounded((timeout) =>
    loadingStatus.waitFor({ state: "visible", timeout })
  );
  if (!(await showsSignedInCallbackCopy(loadingCard, landing, bounded)))
    throw accountReviewCaptureFailure();
  const mainBox = await bounded((timeout) => main.boundingBox({ timeout }));
  if (!mainBox || mainBox.width <= 0 || mainBox.height <= 0)
    throw accountReviewCaptureFailure();
  throwIfAccountReviewAborted(signal);
  remainingAccountReviewBudget(deadline);
};

/**
 * A capture validator for the held callback document. The locator-based
 * default validates the signed-in card and landmarks through Playwright DOM
 * operations; receipt-backed callers supply the adapter validator instead.
 */
type CallbackCaptureValidator = (
  page: Playwright.Page,
  deadline: number,
  signal?: AbortSignal
) => Promise<void> | void;

/**
 * What a held callback capture is checked against: the exact landing for the
 * URL grammar and the validator of the held document.
 */
type HeldCallbackReview = {
  readonly landing: CallbackLanding;
  readonly validate: CallbackCaptureValidator;
};

const locatorHeldCallbackReview = (
  landing: CallbackLanding
): HeldCallbackReview => ({
  landing,
  validate: (page, deadline, signal) =>
    validateSignedInCallbackCapture(page, landing, deadline, signal),
});

const persistAccountReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: ReviewTarget,
  metadata: AccountReviewTargetMetadata,
  screenshot: Buffer,
  deadline: number,
  signal?: AbortSignal,
  heldCallback?: HeldCallbackReview
): Promise<void> => {
  const validateBeforeWrite = async () => {
    throwIfAccountReviewAborted(signal);
    remainingAccountReviewBudget(deadline);
    validateAccountReviewPage(
      page,
      baseUrl,
      target,
      metadata,
      heldCallback?.landing
    );
    if (isCallbackHandoffReviewTarget(target)) {
      if (!heldCallback) throw accountReviewCaptureFailure();
      try {
        await heldCallback.validate(page, deadline, signal);
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
  options: AccountReviewCaptureOptions = {},
  heldCallback?: HeldCallbackReview
): Promise<void> => {
  const deadline =
    options.deadline ?? Date.now() + workspaceE2ETimeouts.browserAction;
  validateAccountReviewPage(
    page,
    baseUrl,
    target,
    metadata,
    heldCallback?.landing
  );

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
      options.signal,
      heldCallback?.landing
    );
    await persistAccountReview(
      page,
      baseUrl,
      target,
      metadata,
      screenshot,
      deadline,
      options.signal,
      heldCallback
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
 * Persistence for the receipt-backed callback document review of a held
 * signed-in callback `target`. The caller supplies the synchronous
 * held-document validator, so no Playwright DOM operation runs while the
 * qualifying request is held. The shared URL checks against the exact
 * `landing` and the revalidation before the mkdir/write still apply; there is
 * no generic public bypass.
 */
export const persistCallbackDocumentReview = async (
  page: Playwright.Page,
  { baseUrl, screenshots }: AccountReviewDestination,
  target: CallbackHandoffReviewTarget,
  landing: CallbackLanding,
  pixels: Buffer,
  validate: () => void,
  options: {
    readonly deadline?: number;
    readonly signal?: AbortSignal;
  } = {}
): Promise<void> => {
  if (!screenshots) return;
  const metadata = accountReviewTargetMetadata[target];
  if (!metadata || !isCallbackHandoffReviewTarget(target))
    throw accountReviewCaptureFailure();
  const deadline =
    options.deadline ?? Date.now() + workspaceE2ETimeouts.browserAction;
  await persistAccountReview(
    page,
    baseUrl,
    target,
    metadata,
    pixels,
    deadline,
    options.signal,
    {
      landing,
      validate: () => {
        validate();
      },
    }
  );
};

/**
 * Captures a held signed-in callback `target` through Playwright DOM
 * operations, checking the page against the exact `landing`: its callback
 * URL grammar and the card's localized label, heading, and body.
 */
export const captureCallbackHandoffReview = async (
  page: Playwright.Page,
  { baseUrl, screenshots }: AccountReviewDestination,
  target: CallbackHandoffReviewTarget,
  landing: CallbackLanding,
  options: AccountReviewCaptureOptions = {}
): Promise<void> => {
  if (!screenshots) return;
  const metadata = accountReviewTargetMetadata[target];
  if (!metadata || !isCallbackHandoffReviewTarget(target))
    throw accountReviewCaptureFailure();
  await captureAccountReviewWithMetadata(
    page,
    baseUrl,
    target,
    metadata,
    options,
    locatorHeldCallbackReview(landing)
  );
};

/**
 * Captures `target` on the current page. The English signed-in callback is
 * checked as the account landing; the Czech returning callback needs its
 * exact return target, so it is captured only through
 * `captureCallbackHandoffReview` and fails closed here.
 */
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
    options,
    target === "callback-signed-in-desktop"
      ? locatorHeldCallbackReview({ locale: "en-US" })
      : undefined
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
