import type { Page } from "@playwright/test";
import type { Effect } from "effect";
import type { AccountReviewDestination } from "../account/review-screenshots";
import type { E2EBrowserSession } from "../browser-session";
import { type WorkspaceE2EError, withoutWorkspaceE2ETimeout } from "../errors";
import type { WorkspaceE2EReferralCheckoutCapture } from "./checkout";
import { captureReferralCheckoutReview } from "./checkout-review";

/**
 * Drives the case's active page natively, once its browser holds that page
 * alone. A referral case passes its step id as the label, and a Playwright
 * timeout fails the step rather than timing it out, as the referral page
 * steps did before the session.
 */
export const onReferralCasePage = <A>(
  session: E2EBrowserSession,
  label: string,
  drive: (page: Page) => Promise<A>
): Effect.Effect<A, WorkspaceE2EError> =>
  session
    .use(label, async (page) => {
      const browser = page.context().browser();
      const pages = browser
        ? browser.contexts().flatMap((context) => context.pages())
        : page.context().pages();
      if (pages.length !== 1 || pages[0] !== page) {
        throw new Error("referral case has no single owned page");
      }
      return drive(page);
    })
    .pipe(withoutWorkspaceE2ETimeout(label));

/** Captures the case's pay page for review, on the case's only page. */
export const captureReferralCheckoutOnCasePage =
  (
    session: E2EBrowserSession,
    review: AccountReviewDestination
  ): WorkspaceE2EReferralCheckoutCapture =>
  ({ expectedPayUrl, orderId, target }) =>
    onReferralCasePage(
      session,
      "capture account referral checkout review",
      (page) =>
        captureReferralCheckoutReview({
          expectedPayUrl,
          orderId,
          page,
          review,
          target,
        })
    );
