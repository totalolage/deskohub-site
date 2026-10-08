import type { Page } from "@playwright/test";
import { type Locale, m } from "@/features/i18n";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type AccountReviewTarget,
  captureAccountReview,
} from "./review-screenshots";

type ReferralOverviewTargets = {
  readonly desktop:
    | "linked-referrals-desktop"
    | "linked-referrals-cs-desktop"
    | "referral-overview-positive-desktop"
    | "referral-overview-positive-cs-desktop";
  readonly mobile:
    | "linked-referrals-mobile"
    | "linked-referrals-cs-mobile"
    | "referral-overview-positive-mobile"
    | "referral-overview-positive-cs-mobile";
};

export const verifyReferralOverview = async ({
  baseUrl,
  count,
  locale,
  page,
  targets,
}: {
  readonly baseUrl: string;
  readonly count: number;
  readonly locale: Locale;
  readonly page: Page;
  readonly targets: ReferralOverviewTargets;
}) => {
  await page.goto(
    new URL(`/${locale}/account?section=referrals`, baseUrl).toString(),
    { timeout: workspaceE2ETimeouts.browserNavigation }
  );
  await page
    .getByText(
      m.accountReferralsEligibleInvitees({ count: String(count) }, { locale }),
      { exact: true }
    )
    .waitFor({
      state: "visible",
      timeout: workspaceE2ETimeouts.browserAction,
    });

  if (count > 0) {
    const discount = `${new Intl.NumberFormat(locale, {
      maximumFractionDigits: 4,
    }).format(5)}%`;
    await page
      .getByText(m.accountReferralsCurrentDiscount({ discount }, { locale }), {
        exact: true,
      })
      .waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
  }

  await captureAccountReview(page, baseUrl, targets.desktop);
  await captureAccountReview(page, baseUrl, targets.mobile);
};

export const verifyReferralInvitationReview = async ({
  baseUrl,
  invitationCode,
  page,
  unavailableCode,
}: {
  readonly baseUrl: string;
  readonly invitationCode: string;
  readonly page: Page;
  readonly unavailableCode: string;
}) => {
  const locale = "en-US";
  const visitInvitation = async (code: string) => {
    const query = new URLSearchParams({ section: "referrals", ref: code });
    await page.goto(
      new URL(`/en-US/account?${query.toString()}`, baseUrl).toString(),
      { timeout: workspaceE2ETimeouts.browserNavigation }
    );
    await page
      .getByRole("heading", {
        exact: true,
        level: 3,
        name: m.accountReferralsInvitationTitle({}, { locale }),
      })
      .waitFor({
        state: "visible",
        timeout: workspaceE2ETimeouts.browserAction,
      });
  };
  const acceptButton = page.getByRole("button", {
    exact: true,
    name: m.accountReferralsAccept({}, { locale }),
  });
  const waitForMessage = async (message: string) => {
    await page.getByText(message, { exact: true }).waitFor({
      state: "visible",
      timeout: workspaceE2ETimeouts.browserAction,
    });
  };
  const capture = (target: AccountReviewTarget) =>
    captureAccountReview(page, baseUrl, target);

  await visitInvitation(invitationCode);
  await capture("referral-invitation-eligible-desktop");
  await acceptButton.click({ timeout: workspaceE2ETimeouts.browserAction });
  await waitForMessage(m.accountReferralsAccepted({}, { locale }));
  await capture("referral-invitation-accepted-desktop");

  await visitInvitation(unavailableCode);
  await acceptButton.click({ timeout: workspaceE2ETimeouts.browserAction });
  await waitForMessage(m.accountReferralsUnavailable({}, { locale }));
  await capture("referral-invitation-unavailable-desktop");

  await page.goto(
    new URL("/en-US/account?section=referrals", baseUrl).toString(),
    { timeout: workspaceE2ETimeouts.browserNavigation }
  );
};
