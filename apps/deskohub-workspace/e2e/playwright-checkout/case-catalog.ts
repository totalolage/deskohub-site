// Cases that never open a Nexi hosted payment, longest median deployed
// duration first.
export const workspaceE2ENonPaymentCaseIds = [
  "automation-reservation-booked",
  "voucher-reuse-and-exhaustion",
  "discount-code-capacity-reached",
  "referral-profile-completion-checkout",
  "checkout-signed-out-verification",
  "reservation-link-meeting-room-zero-total-en-US",
  "discount-code-already-redeemed",
  "referral-checkout-code-entry",
  "checkout-meeting-room-zero-total-four-hours",
  "reservation-replacement",
  "referral-referrer-screen",
  "meeting-room-reservation-replacement",
  "checkout-zero-total",
  "calendar-sale-pricing-changes",
  "reservation-link-meeting-room-unknown-code-en-US",
  "referral-share-link-checkout",
  "reservation-link-meeting-room-zero-total-cs-CZ",
  "referral-auto-linked-sign-in",
  "discount-code-expires-before-payment",
  "customer-discount-changes-before-payment",
  "locale-switch",
  "discount-code-unknown",
  "discount-code-customer-ineligible",
  "reservation-url-state-cowork",
  "reservation-url-state-office-starts-on-link",
  "referral-profile-completion-unusable-link",
  "reservation-url-state-office",
  "reservation-url-state-meeting-room",
  "contact-form",
] as const;

// Cases that pay on the Nexi hosted page, longest median deployed duration
// first. Only their hosted-payment portion holds the run's hosted-payment
// permit.
const workspaceE2EPaidCaseIds = [
  "checkout-calendar-sale",
  "checkout-referral-someone-else",
  "payment-late-recovery-recreated",
  "checkout-meeting-room-paid-one-hour",
  "checkout-meeting-room-paid-whole-day",
  "checkout-agent-booking",
  "checkout-cowork-basic",
  "checkout-all-discounts",
  "checkout-office-paid-multi-day",
  "payment-late-recovery-refund-required",
  "checkout-voucher-full-usage",
  "checkout-discount-code",
  "payment-authentication-failed",
  "payment-meeting-room-cancelled",
  "payment-cancelled",
] as const;

/**
 * Referral cases that seed and sign in their own synthetic identities, so no
 * case spends a magic link or shares an account. They never pay and sit in the
 * non-payment list above by duration; this list keeps their planning order.
 */
export const workspaceE2EReferralCaseIds = [
  "referral-referrer-screen",
  "referral-profile-completion-checkout",
  "referral-checkout-code-entry",
  "referral-share-link-checkout",
  "referral-auto-linked-sign-in",
  "referral-profile-completion-unusable-link",
] as const satisfies readonly (typeof workspaceE2ENonPaymentCaseIds)[number][];

export type WorkspaceE2EReferralCaseId =
  (typeof workspaceE2EReferralCaseIds)[number];

export const isWorkspaceE2EReferralCaseId = (
  value: string
): value is WorkspaceE2EReferralCaseId =>
  (workspaceE2EReferralCaseIds as readonly string[]).includes(value);

/**
 * Cases that need the office page. A preview with the office page disabled
 * plans none of them.
 */
const workspaceE2EOfficeCaseIds = [
  "checkout-office-paid-multi-day",
  "reservation-url-state-office",
  "reservation-url-state-office-starts-on-link",
] as const satisfies readonly WorkspaceE2ECaseId[];

export const isWorkspaceE2EOfficeCaseId = (value: string) =>
  (workspaceE2EOfficeCaseIds as readonly string[]).includes(value);

/**
 * Cases too slow for the per-PR gate. They run only when the run opts into
 * nightly cases, as the nightly run against main does.
 */
const workspaceE2ENightlyCaseIds = [
  "automation-reservation-booked",
] as const satisfies readonly WorkspaceE2ECaseId[];

export const isWorkspaceE2ENightlyCaseId = (value: string) =>
  (workspaceE2ENightlyCaseIds as readonly string[]).includes(value);

export const workspaceE2ECaseIds = [
  ...workspaceE2ENonPaymentCaseIds,
  ...workspaceE2EPaidCaseIds,
] as const;

export type WorkspaceE2ECaseId = (typeof workspaceE2ECaseIds)[number];

// Playwright admits the case pool in registration order. Alternating paid and
// non-payment cases, each longest first, keeps about three hosted sessions in
// demand at a time, so case workers rarely wait for the hosted-payment permit.
export const workspaceE2ECasePoolOrder: readonly WorkspaceE2ECaseId[] =
  Array.from(
    {
      length: Math.max(
        workspaceE2EPaidCaseIds.length,
        workspaceE2ENonPaymentCaseIds.length
      ),
    },
    (_, index) => [
      workspaceE2EPaidCaseIds[index],
      workspaceE2ENonPaymentCaseIds[index],
    ]
  )
    .flat()
    .filter((caseId) => caseId !== undefined);

export const isWorkspaceE2ECaseId = (
  value: string
): value is WorkspaceE2ECaseId =>
  (workspaceE2ECaseIds as readonly string[]).includes(value);
