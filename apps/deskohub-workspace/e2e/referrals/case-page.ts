import type { Page } from "@playwright/test";
import { Effect } from "effect";
import type { AccountReviewDestination } from "../account/review-screenshots";
import type { E2EBrowserSession } from "../browser-session";
import {
  type WorkspaceE2EError,
  withoutWorkspaceE2ETimeout,
  workspaceE2EError,
} from "../errors";
import type { WorkspaceE2EReferralCheckoutCapture } from "./checkout";
import { captureReferralCheckoutReview } from "./checkout-review";

/**
 * Drives the case's active page natively, once its browser holds that page
 * alone. A referral case passes its step id as the label. As the referral
 * page steps did before the session, every rejection of `drive` fails as
 * `<label> failed` with the rejection as its cause: a Playwright timeout
 * fails the step, and a Workspace E2E error the callback throws keeps its
 * timeout but not its diagnostic code.
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
      return page;
    })
    .pipe(
      withoutWorkspaceE2ETimeout(label),
      Effect.flatMap((page) =>
        Effect.tryPromise({
          catch: (cause) =>
            workspaceE2EError(`${label} failed`, { cause, operation: label }),
          try: () => drive(page),
        })
      )
    );

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
