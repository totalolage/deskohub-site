import type { AccountSection } from "@/features/account/sections";
import type { ReservationCustomerMode } from "@/features/reservation/reservation-existing-customer";
import type { WorkspaceE2EAccountCaseId } from "./catalog";
import type { AccountReviewTarget } from "./review-screenshots";

/**
 * The deployed review-capture targets of the serial account lane, shared
 * data for the lane runtime and its wiring contract tests. The desktop map
 * covers every section; reservations, billing, danger, and the profile
 * language view gain a mobile capture, so the mobile map stays explicitly
 * undefined elsewhere.
 */
export const accountReviewTargetBySection = {
  reservations: "linked-reservations-desktop",
  referrals: "linked-referrals-desktop",
  profile: "linked-profile-desktop",
  security: "linked-security-desktop",
  assistants: "linked-assistants-desktop",
  billing: "linked-billing-desktop",
  legal: "linked-legal-desktop",
  danger: "linked-danger-desktop",
} as const satisfies Readonly<Record<AccountSection, AccountReviewTarget>>;

export const mobileAccountReviewTargetBySection: Readonly<
  Record<AccountSection, AccountReviewTarget | undefined>
> = {
  reservations: "linked-reservations-mobile",
  referrals: "linked-referrals-mobile",
  billing: "linked-billing-mobile",
  danger: "linked-danger-mobile",
  profile: "linked-profile-language-mobile",
  security: undefined,
  assistants: undefined,
  legal: undefined,
};

export const accountReviewTargetByCaseId: Partial<
  Record<WorkspaceE2EAccountCaseId, AccountReviewTarget>
> = {
  "account-anonymous-redirect": "sign-in-desktop",
  "account-sign-in-form": "sign-in-accepted-desktop",
  "account-magic-link-delivery": "completion-mobile375x900",
  "account-linking-variants": "support-desktop",
  "account-locale-preference": "linked-profile-language-desktop",
};

/**
 * The language case's mid-case review moments, each captured while the state
 * it shows is genuine: the Czech profile after the profile control moved the
 * site to Czech, the Czech page a conflicting en-US URL and cookie were
 * redirected to, and the English account page the header switch moved the
 * preference to.
 */
export const languagePreferenceReviewTargetByStage = {
  "czech-profile": "linked-profile-language-desktop-cs",
  "preference-redirect": "locale-preference-redirect-desktop",
  "switcher-saved": "locale-switcher-saved-desktop",
} as const satisfies Readonly<Record<string, AccountReviewTarget>>;

export type LanguagePreferenceReviewStage =
  keyof typeof languagePreferenceReviewTargetByStage;

/**
 * The cross-browser sign-in's review moments in the assistant's browser: the
 * Czech card its accepted request shows, and the failure card the link it
 * replays after another browser consumed it lands on. The signed-in callback
 * between them is captured by the lane's callback handoff hold.
 */
export const signInHandoffReviewTargetByStage = {
  "sign-in-accepted": "sign-in-accepted-cs-desktop",
  "callback-failed": "callback-failed-cs-desktop",
} as const satisfies Readonly<Record<string, AccountReviewTarget>>;

export type SignInHandoffReviewStage =
  keyof typeof signInHandoffReviewTargetByStage;

export type SignInHandoffReviewCapture = (
  stage: SignInHandoffReviewStage
) => Promise<void>;

/**
 * The cowork reservation customer section in each mode: the signed-in
 * account card and the "book for someone else" contact inputs.
 */
export const reservationCustomerReviewTargetByMode = {
  account: "reservation-customer-account-desktop",
  contact: "reservation-customer-contact-desktop",
} as const satisfies Readonly<
  Record<ReservationCustomerMode, AccountReviewTarget>
>;
