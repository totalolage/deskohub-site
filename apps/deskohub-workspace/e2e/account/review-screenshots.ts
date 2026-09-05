import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type * as Playwright from "@playwright/test";
import { workspaceDir } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

export type AccountReviewTarget =
  | "completion-mobile375x900"
  | "linked-desktop1440x1000"
  | "linked-history-desktop"
  | "support-desktop"
  | "sign-in-accepted-desktop"
  | "sign-in-desktop"
  | "callback-failed-desktop"
  | "deleted-desktop";

type AccountReviewTargetMetadata = {
  readonly filename: `${string}.png`;
  readonly path: string;
  readonly viewport: Playwright.ViewportSize;
};

const accountReviewTargetMetadata = {
  "completion-mobile375x900": {
    filename: "completion-mobile375x900.png",
    path: "/en-US/account",
    viewport: { height: 900, width: 375 },
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

/**
 * Callers own the synthetic browser context and account state. This helper only
 * emits the explicitly requested PNG; it creates no browser, auth, database,
 * cookie, trace, HAR, or logging state.
 */
export const captureAccountReview = async (
  page: Playwright.Page,
  baseUrl: string,
  target: AccountReviewTarget
): Promise<void> => {
  const metadata = accountReviewTargetMetadata[target];
  if (!metadata) throw new Error(accountReviewCaptureFailureMessage);

  let pageUrl: URL;
  let base: URL;
  try {
    pageUrl = new URL(page.url());
    base = new URL(baseUrl);
  } catch {
    throw new Error(accountReviewCaptureFailureMessage);
  }

  const queryIsAllowed =
    pageUrl.search === "" ||
    (target === "callback-failed-desktop" &&
      pageUrl.search === "?error=INVALID_TOKEN");
  if (
    pageUrl.origin !== base.origin ||
    pageUrl.pathname !== metadata.path ||
    !queryIsAllowed ||
    pageUrl.hash !== ""
  ) {
    throw new Error(accountReviewCaptureFailureMessage);
  }

  let previousViewport: Playwright.ViewportSize | null;
  try {
    previousViewport = page.viewportSize();
  } catch {
    throw new Error(accountReviewCaptureFailureMessage);
  }
  if (previousViewport === null)
    throw new Error(accountReviewCaptureFailureMessage);

  let captureFailed = false;
  try {
    await mkdir(accountReviewArtifactDirectory, { recursive: true });
    await page.setViewportSize(metadata.viewport);
    await waitForDocumentFonts(page);
    await page.screenshot({
      animations: "disabled",
      fullPage: true,
      path: resolve(accountReviewArtifactDirectory, metadata.filename),
      timeout: workspaceE2ETimeouts.browserAction,
    });
  } catch {
    captureFailed = true;
  } finally {
    try {
      await page.setViewportSize(previousViewport);
    } catch {
      captureFailed = true;
    }
  }

  if (captureFailed) throw new Error(accountReviewCaptureFailureMessage);
};

const waitForDocumentFonts = async (page: Playwright.Page): Promise<void> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      page.evaluate(() => document.fonts.ready.then(() => undefined)),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(accountReviewCaptureFailureMessage)),
          workspaceE2ETimeouts.browserAction
        );
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
};
