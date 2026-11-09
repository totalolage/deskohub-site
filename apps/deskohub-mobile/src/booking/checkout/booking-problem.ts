import type {
  CustomerAccountLinkRequired,
  CustomerBookingDateOutOfRange,
  CustomerBookingSelectionInvalid,
  CustomerCheckoutDetailsInvalid,
  CustomerCheckoutNotFound,
  CustomerCheckoutUnavailable,
  CustomerCheckoutUnavailableReason,
  CustomerConsentRequired,
  CustomerDiscountCodeRejected,
  CustomerLegalDocumentsChanged,
  CustomerOfferingUnavailable,
  CustomerQuoteExpired,
  CustomerSelectionUnavailable,
  CustomerServiceUnavailable,
} from "@deskohub/workspace-customer-api";
import { Data, Match, Option } from "effect";
import type { PaymentBrowserUnavailable } from "../payment-browser.service";

/**
 * The shared request failures the command interpreter hands over after the
 * customer API layer has handled sessions and budgets:
 * - `RequestUnconfirmed`: a write's answer was lost, so it may have applied:
 *   any write that timed out or lost its connection after it was sent.
 * - `RequestUnavailable`: a failure that proves nothing changed, such as a
 *   read's connection failure, or a write that was never sent.
 * - `RequestRateLimited`: the account spent its request budget.
 * - `RequestSessionRequired`: the session lapsed; signing in again resumes.
 */
export type CustomerRequestFailure = Data.TaggedEnum<{
  RequestUnconfirmed: Record<never, never>;
  RequestUnavailable: Record<never, never>;
  RequestRateLimited: Record<never, never>;
  RequestSessionRequired: Record<never, never>;
}>;
export const CustomerRequestFailure = Data.taggedEnum<CustomerRequestFailure>();

/** Every failure a checkout command can end with. */
export type CheckoutFailure =
  | CustomerBookingSelectionInvalid
  | CustomerBookingDateOutOfRange
  | CustomerOfferingUnavailable
  | CustomerCheckoutDetailsInvalid
  | CustomerSelectionUnavailable
  | CustomerQuoteExpired
  | CustomerAccountLinkRequired
  | CustomerCheckoutNotFound
  | CustomerCheckoutUnavailable
  | CustomerDiscountCodeRejected
  | CustomerLegalDocumentsChanged
  | CustomerConsentRequired
  | CustomerServiceUnavailable
  | PaymentBrowserUnavailable
  | CustomerRequestFailure;

/** Why the booking starts over from the family screen, which quotes again. */
export type CheckoutRestartReason =
  | "hold_expired"
  | "availability_changed"
  | "checkout_conflict"
  | "quote_expired"
  | "offer_replaced"
  | "reservation_ended"
  | "selection_invalid"
  | "date_out_of_range"
  | "offering_unavailable"
  | "checkout_not_found";

/** Why the account can't book: its customer link, or a review account. */
export type CheckoutBlockedReason =
  | CustomerAccountLinkRequired["reason"]
  | "payment-disabled";

/**
 * What went wrong that the customer can retry as is: the service, the
 * connection, the request budget, the session, or the payment page.
 */
export type CheckoutRetryKind =
  | "service_unavailable"
  | "connection"
  | "rate_limited"
  | "session_required"
  | "payment_browser"
  | "unexpected";

/** A token the server signed after rejecting a code, which keeps the hold. */
export interface CheckoutReplacementToken {
  readonly payStateToken: string;
  readonly expiresAt: string;
}

/**
 * A failure as the checkout acts on it:
 * - `Restart`: start a new booking (the hold, quote or selection is gone).
 * - `ShowStatus`: the order's payment started or it can't be paid; its
 *   status screen tells which.
 * - `Blocked`: the account can't book here.
 * - `DetailsInvalid`: the contact or billing field to correct.
 * - `PriceReviewPending`: accept the changed price first.
 * - `ConsentRequired` / `LegalDocumentsChanged`: ask for consent again.
 * - `CodeRejected`: the code wasn't applied; the checkout stays payable.
 * - `Retryable`: nothing changed; the same request can be sent again.
 * - `Unconfirmed`: a write may have applied; only resending it settles that.
 */
export type BookingProblem = Data.TaggedEnum<{
  Restart: { readonly reason: CheckoutRestartReason };
  ShowStatus: Record<never, never>;
  Blocked: { readonly reason: CheckoutBlockedReason };
  DetailsInvalid: { readonly field: Option.Option<string> };
  PriceReviewPending: Record<never, never>;
  ConsentRequired: { readonly consent: CustomerConsentRequired["consent"] };
  LegalDocumentsChanged: Record<never, never>;
  CodeRejected: {
    readonly reason: CustomerDiscountCodeRejected["reason"];
    readonly replacement: Option.Option<CheckoutReplacementToken>;
  };
  Retryable: { readonly kind: CheckoutRetryKind };
  Unconfirmed: Record<never, never>;
}>;
export const BookingProblem = Data.taggedEnum<BookingProblem>();

const restart = (reason: CheckoutRestartReason) =>
  BookingProblem.Restart({ reason });

const retryable = (kind: CheckoutRetryKind) =>
  BookingProblem.Retryable({ kind });

/** Classifies a failed checkout command, as the booking pages do. */
export const bookingProblem = (failure: CheckoutFailure): BookingProblem =>
  Match.valueTags(failure, {
    CustomerBookingSelectionInvalid: () => restart("selection_invalid"),
    CustomerBookingDateOutOfRange: () => restart("date_out_of_range"),
    CustomerOfferingUnavailable: () => restart("offering_unavailable"),
    CustomerCheckoutDetailsInvalid: ({ field }) =>
      BookingProblem.DetailsInvalid({ field: Option.fromUndefinedOr(field) }),
    CustomerSelectionUnavailable: ({ reason }) => restart(reason),
    CustomerQuoteExpired: () => restart("quote_expired"),
    CustomerAccountLinkRequired: ({ reason }) =>
      BookingProblem.Blocked({ reason }),
    CustomerCheckoutNotFound: () => restart("checkout_not_found"),
    CustomerCheckoutUnavailable: ({ reason }) => checkoutUnavailable(reason),
    CustomerDiscountCodeRejected: (rejected) =>
      BookingProblem.CodeRejected({
        reason: rejected.reason,
        replacement: replacementToken(rejected),
      }),
    CustomerLegalDocumentsChanged: () => BookingProblem.LegalDocumentsChanged(),
    CustomerConsentRequired: ({ consent }) =>
      BookingProblem.ConsentRequired({ consent }),
    CustomerServiceUnavailable: () => retryable("service_unavailable"),
    PaymentBrowserUnavailable: () => retryable("payment_browser"),
    RequestUnconfirmed: () => BookingProblem.Unconfirmed(),
    RequestUnavailable: () => retryable("connection"),
    RequestRateLimited: () => retryable("rate_limited"),
    RequestSessionRequired: () => retryable("session_required"),
  });

const checkoutUnavailable = (
  reason: CustomerCheckoutUnavailableReason
): BookingProblem =>
  Match.value(reason).pipe(
    Match.when("expired", () => restart("hold_expired")),
    Match.whenOr("payment_in_progress", "not_payable", () =>
      BookingProblem.ShowStatus()
    ),
    Match.when("price_review_pending", () =>
      BookingProblem.PriceReviewPending()
    ),
    Match.when("reservation_ended", () => restart("reservation_ended")),
    Match.when("offer_replaced", () => restart("offer_replaced")),
    Match.exhaustive
  );

/** The contract sends both fields of a replacement token, or neither. */
const replacementToken = (
  rejected: CustomerDiscountCodeRejected
): Option.Option<CheckoutReplacementToken> =>
  Option.all({
    payStateToken: Option.fromUndefinedOr(rejected.payStateToken),
    expiresAt: Option.fromUndefinedOr(rejected.expiresAt),
  });
