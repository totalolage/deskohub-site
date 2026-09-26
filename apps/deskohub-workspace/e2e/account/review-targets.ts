import type { AccountSection } from "@/features/account/components/shell/account-shell";
import type { WorkspaceE2EAccountCaseId } from "./catalog";
import type { AccountReviewTarget } from "./review-screenshots";

/**
 * The deployed review-capture targets of the serial account lane, shared
 * data for the lane runtime and its wiring contract tests. The desktop map
 * covers every section; only reservations, billing, and danger gain a
 * mobile capture, so the mobile map stays explicitly undefined elsewhere.
 */
export const accountReviewTargetBySection = {
  reservations: "linked-reservations-desktop",
  profile: "linked-profile-desktop",
  billing: "linked-billing-desktop",
  legal: "linked-legal-desktop",
  danger: "linked-danger-desktop",
} as const satisfies Readonly<Record<AccountSection, AccountReviewTarget>>;

export const mobileAccountReviewTargetBySection: Readonly<
  Record<AccountSection, AccountReviewTarget | undefined>
> = {
  reservations: "linked-reservations-mobile",
  billing: "linked-billing-mobile",
  danger: "linked-danger-mobile",
  profile: undefined,
  legal: undefined,
};

export const accountReviewTargetByCaseId: Partial<
  Record<WorkspaceE2EAccountCaseId, AccountReviewTarget>
> = {
  "account-anonymous-redirect": "sign-in-desktop",
  "account-sign-in-form": "sign-in-accepted-desktop",
  "account-magic-link-delivery": "completion-mobile375x900",
  "account-session-lifecycle": "callback-failed-desktop",
  "account-linking-variants": "support-desktop",
};
