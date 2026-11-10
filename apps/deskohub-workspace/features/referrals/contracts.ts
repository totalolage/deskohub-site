import type { DotyposReadFailure } from "@deskohub/dotypos";
import { Data } from "effect";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type {
  CustomerAccountFailureCode,
  CustomerSessionReadDiagnostic,
} from "@/features/account/customer-account";
import type { Money } from "@/shared/money/money";
import type { ReferralCode } from "./client";

export type ReferralAcceptance =
  | { readonly kind: "accepted" }
  | { readonly kind: "already_accepted" };

/**
 * A referral code a checkout may carry for its customer. `eligible` means the
 * invitation can be priced and attributed when the order is paid;
 * `already_accepted` means the customer is already attributed to that
 * referrer, so the code adds nothing to carry.
 */
export type CheckoutReferralEvaluation =
  | { readonly kind: "eligible"; readonly code: ReferralCode }
  | { readonly kind: "already_accepted" };

export type ReferralCodeKind =
  | { readonly kind: "referral" }
  | { readonly kind: "other" };

export type ReferralAccountSummary = {
  readonly code: ReferralCode;
  /** Every customer who joined with this customer's referral. */
  readonly inviteeCount: number;
  /** Invited customers who currently count toward the referrer discount. */
  readonly eligibleInviteeCount: number;
  /** Exact percentage represented as a canonical decimal, without a percent sign. */
  readonly discount: string;
  /**
   * Referral discounts applied to this customer's own paid bookings, less
   * the refunded share of each payment, one positive total per currency,
   * ordered by currency code. Empty when referrals have saved nothing yet.
   */
  readonly savings: readonly Money[];
};

/** The account referral summary with the customer's absolute share link. */
export type ReferralAccountOverview = {
  readonly summary: ReferralAccountSummary;
  readonly shareUrl: string;
};

/** A verdict that the code can't refer this customer now. */
export type ReferralRejection =
  /**
   * The code can't refer anyone: it is unknown, disabled, outside its
   * validity window, or its owner has no active linked account. The account
   * summary also reports a share code it could not issue this way.
   */
  | "unavailable"
  | "self_referral"
  | "already_attributed"
  /** The customer already has a paid booking, so the invitation window has closed. */
  | "ineligible"
  /**
   * The customer has no paid booking yet, but a payment is in progress (or
   * holds the invitation) and may still become their first paid booking.
   */
  | "pending_payment"
  /** The code's owner was invited, directly or through others, by this customer. */
  | "cycle";

type ReferralFailureReason =
  | "invalid_code"
  | ReferralRejection
  | "account_unavailable"
  /**
   * The code's owner relinked their account, or the code changed hands, while
   * acceptance took its locks. Not a verdict: a later attempt decides.
   */
  | "referrer_changed"
  /**
   * The referral program is withheld, or its feature flag could not be
   * evaluated. Never a verdict on the code or the customer: callers that
   * store an outcome keep it pending.
   */
  | "disabled";

export class ReferralError extends Data.TaggedError("ReferralError")<{
  readonly reason: ReferralFailureReason;
}> {}

/**
 * The referral store or Dotypos failed, so no verdict was reached. It says
 * nothing about the code or the customer, and a later attempt can succeed.
 */
export type ReferralOutage = DatabaseQueryError | DotyposReadFailure;

/**
 * The signed-in session could not be read, so the account behind an account
 * operation could not be checked. Like an outage, it says nothing about the
 * code or the customer, and a later attempt can succeed.
 */
export class ReferralAuthenticationUnavailable extends Data.TaggedError(
  "ReferralAuthenticationUnavailable"
)<{
  readonly diagnostic?: CustomerSessionReadDiagnostic;
}> {}

/**
 * The signed-in account could not be checked under its lock: the lock or the
 * account's deletion state could not be read. `code` names which. Like an
 * outage, it says nothing about the code or the customer, and a later attempt
 * can succeed.
 */
export class ReferralAccountCheckUnavailable extends Data.TaggedError(
  "ReferralAccountCheckUnavailable"
)<{
  readonly code?: CustomerAccountFailureCode;
}> {}

/** How an operation for the signed-in account fails without a verdict. */
export type ReferralAccountOutage =
  | ReferralOutage
  | ReferralAuthenticationUnavailable
  | ReferralAccountCheckUnavailable;
