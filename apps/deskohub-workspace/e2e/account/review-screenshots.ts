import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import { workspaceDir } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

export type AccountReviewTarget =
  | "completion-mobile375x900"
  | "account-loading-desktop"
  | "sign-in-handoff-desktop"
  | "linked-desktop1440x1000"
  | "linked-history-desktop"
  | "support-desktop"
  | "sign-in-accepted-desktop"
  | "sign-in-pending-desktop"
  | "sign-in-desktop"
  | "callback-failed-desktop"
  | "deleted-desktop";

type AccountReviewTargetMetadata = {
  readonly filename: `${string}.png`;
  readonly path: string | readonly string[];
  readonly viewport: Playwright.ViewportSize;
};

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
  "sign-in-handoff-desktop": {
    filename: "sign-in-handoff-desktop.png",
    path: ["/en-US/account", "/en-US/auth/sign-in"],
    viewport: { height: 1000, width: 1440 },
  },
  "linked-desktop1440x1000": {
    filename: "linked-desktop1440x1000.png",
    path: "/en-US/account",
    viewport: { height: 1000, width: 1440 },
  },
  "linked-history-desktop": {
    filename: "linked-history-desktop.png",
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

const accountReviewArtifactDirectory = resolve(
  workspaceDir,
  "e2e-artifacts",
  "account-review"
);
const accountReviewCaptureFailureMessage =
  "Account review screenshot capture failed";

const accountReviewCaptureFailure = () =>
  new Error(accountReviewCaptureFailureMessage);

const remainingAccountReviewBudget = (deadline: number): number => {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0)
    throw accountReviewCaptureFailure();
  return remaining;
};

const validateAccountReviewPage = (
  page: Playwright.Page,
  baseUrl: string,
  target: AccountReviewTarget,
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
  target: AccountReviewTarget,
  deadline: number
): Promise<void> => {
  const metadata = accountReviewTargetMetadata[target];
  if (!metadata) throw accountReviewCaptureFailure();

  validateAccountReviewPage(page, baseUrl, target, metadata);
  await waitForDocumentFonts(page, deadline);
  remainingAccountReviewBudget(deadline);
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: resolve(accountReviewArtifactDirectory, metadata.filename),
    timeout: remainingAccountReviewBudget(deadline),
  });
  remainingAccountReviewBudget(deadline);
};

/**
 * Callers own the synthetic browser context and account state. This helper only
 * emits the explicitly requested PNG; it creates no browser, auth, database,
 * cookie, trace, HAR, or logging state.
 */
export const captureAccountReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: AccountReviewTarget,
  options: { readonly deadline?: number } = {}
): Promise<void> => {
  const deadline =
    options.deadline ?? Date.now() + workspaceE2ETimeouts.browserAction;
  const metadata = accountReviewTargetMetadata[target];
  if (!metadata) throw accountReviewCaptureFailure();

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
    remainingAccountReviewBudget(deadline);
    await mkdir(accountReviewArtifactDirectory, { recursive: true });
    remainingAccountReviewBudget(deadline);
    await page.setViewportSize(metadata.viewport);
    remainingAccountReviewBudget(deadline);
    await captureAccountReviewPixels(page, baseUrl, target, deadline);
  } catch {
    captureFailed = true;
  } finally {
    try {
      await page.setViewportSize(previousViewport);
    } catch {
      captureFailed = true;
    }
  }

  if (captureFailed) throw accountReviewCaptureFailure();
};

const waitForDocumentFonts = async (
  page: Playwright.Page,
  deadline: number
): Promise<void> => {
  const timeout = remainingAccountReviewBudget(deadline);
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(accountReviewCaptureFailure()),
          timeout
        );
      }),
    ]);
    remainingAccountReviewBudget(deadline);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
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
  let routeInstalled = false;
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
        await captureAccountReviewPixels(
          page,
          baseUrl,
          "sign-in-pending-desktop",
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
    await mkdir(accountReviewArtifactDirectory, { recursive: true });
    await page.setViewportSize(pendingMetadata.viewport);
    const magicLinkUrl = new URL(
      "/api/auth/sign-in/magic-link",
      baseUrl
    ).toString();
    await page.route(magicLinkUrl, handleMagicLinkRoute, { times: 1 });
    routeInstalled = true;
    try {
      await runCase();
    } catch (cause) {
      runCaseFailed = true;
      runCaseFailure = cause;
    }
    if (routeInstalled) {
      try {
        await page.unroute(magicLinkUrl, handleMagicLinkRoute);
      } catch {
        wrapperFailed = true;
      }
      if (fullHandlerPromise) {
        try {
          await fullHandlerPromise;
        } catch {
          wrapperFailed = true;
        }
      } else {
        reviewFailed = true;
      }
    }
  } catch {
    wrapperFailed = true;
  } finally {
    if (previousViewport !== null) {
      try {
        await page.setViewportSize(previousViewport);
      } catch {
        wrapperFailed = true;
      }
    }
  }

  if (runCaseFailed) throw runCaseFailure;
  if (wrapperFailed || reviewFailed || !fullHandlerPromise)
    throw accountReviewCaptureFailure();
};
