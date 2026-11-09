import { describe, expect, test } from "bun:test";
import {
  CustomerAccountLinkRequired,
  CustomerBookingDateOutOfRange,
  CustomerBookingSelectionInvalid,
  CustomerCheckoutDetailsInvalid,
  CustomerCheckoutNotFound,
  CustomerCheckoutUnavailable,
  CustomerConsentRequired,
  CustomerDiscountCodeRejected,
  CustomerLegalDocumentsChanged,
  CustomerOfferingUnavailable,
  CustomerQuoteExpired,
  CustomerSelectionUnavailable,
  CustomerServiceUnavailable,
} from "@deskohub/workspace-customer-api";
import { Option } from "effect";
import { PaymentBrowserUnavailable } from "../payment-browser.service";
import {
  BookingProblem,
  bookingProblem,
  type CheckoutFailure,
  CustomerRequestFailure,
} from "./booking-problem";

const cases: ReadonlyArray<readonly [string, CheckoutFailure, BookingProblem]> =
  [
    [
      "selection invalid",
      new CustomerBookingSelectionInvalid({ field: "tier" }),
      BookingProblem.Restart({ reason: "selection_invalid" }),
    ],
    [
      "date out of range",
      new CustomerBookingDateOutOfRange({
        earliest: "2026-11-07",
        latest: "2027-05-07",
      }),
      BookingProblem.Restart({ reason: "date_out_of_range" }),
    ],
    [
      "offering unavailable",
      new CustomerOfferingUnavailable({ family: "office" }),
      BookingProblem.Restart({ reason: "offering_unavailable" }),
    ],
    [
      "details invalid with a field",
      new CustomerCheckoutDetailsInvalid({ field: "contact.email" }),
      BookingProblem.DetailsInvalid({ field: Option.some("contact.email") }),
    ],
    [
      "details invalid without a field",
      new CustomerCheckoutDetailsInvalid({}),
      BookingProblem.DetailsInvalid({ field: Option.none() }),
    ],
    [
      "availability changed",
      new CustomerSelectionUnavailable({ reason: "availability_changed" }),
      BookingProblem.Restart({ reason: "availability_changed" }),
    ],
    [
      "checkout conflict",
      new CustomerSelectionUnavailable({ reason: "checkout_conflict" }),
      BookingProblem.Restart({ reason: "checkout_conflict" }),
    ],
    [
      "quote expired",
      new CustomerQuoteExpired(),
      BookingProblem.Restart({ reason: "quote_expired" }),
    ],
    [
      "account link required",
      new CustomerAccountLinkRequired({ reason: "support-required" }),
      BookingProblem.Blocked({ reason: "support-required" }),
    ],
    [
      "checkout not found",
      new CustomerCheckoutNotFound(),
      BookingProblem.Restart({ reason: "checkout_not_found" }),
    ],
    [
      "hold expired",
      new CustomerCheckoutUnavailable({ reason: "expired" }),
      BookingProblem.Restart({ reason: "hold_expired" }),
    ],
    [
      "payment in progress",
      new CustomerCheckoutUnavailable({ reason: "payment_in_progress" }),
      BookingProblem.ShowStatus(),
    ],
    [
      "not payable",
      new CustomerCheckoutUnavailable({ reason: "not_payable" }),
      BookingProblem.ShowStatus(),
    ],
    [
      "price review pending",
      new CustomerCheckoutUnavailable({ reason: "price_review_pending" }),
      BookingProblem.PriceReviewPending(),
    ],
    [
      "reservation ended",
      new CustomerCheckoutUnavailable({ reason: "reservation_ended" }),
      BookingProblem.Restart({ reason: "reservation_ended" }),
    ],
    [
      "offer replaced",
      new CustomerCheckoutUnavailable({ reason: "offer_replaced" }),
      BookingProblem.Restart({ reason: "offer_replaced" }),
    ],
    [
      "code rejected with a replacement token",
      new CustomerDiscountCodeRejected({
        reason: "unavailable",
        payStateToken: "token-2",
        expiresAt: "2026-11-20T09:15:00.000Z",
      }),
      BookingProblem.CodeRejected({
        reason: "unavailable",
        replacement: Option.some({
          payStateToken: "token-2",
          expiresAt: "2026-11-20T09:15:00.000Z",
        }),
      }),
    ],
    [
      "code rejected without a replacement token",
      new CustomerDiscountCodeRejected({ reason: "code_already_applied" }),
      BookingProblem.CodeRejected({
        reason: "code_already_applied",
        replacement: Option.none(),
      }),
    ],
    [
      "legal documents changed",
      new CustomerLegalDocumentsChanged(),
      BookingProblem.LegalDocumentsChanged(),
    ],
    [
      "early-performance consent required",
      new CustomerConsentRequired({ consent: "early_performance" }),
      BookingProblem.ConsentRequired({ consent: "early_performance" }),
    ],
    [
      "service unavailable",
      new CustomerServiceUnavailable(),
      BookingProblem.Retryable({ kind: "service_unavailable" }),
    ],
    [
      "payment page unavailable",
      new PaymentBrowserUnavailable({ cause: "locked" }),
      BookingProblem.Retryable({ kind: "payment_browser" }),
    ],
    [
      "write unconfirmed",
      CustomerRequestFailure.RequestUnconfirmed(),
      BookingProblem.Unconfirmed(),
    ],
    [
      "request unavailable",
      CustomerRequestFailure.RequestUnavailable(),
      BookingProblem.Retryable({ kind: "connection" }),
    ],
    [
      "rate limited",
      CustomerRequestFailure.RequestRateLimited(),
      BookingProblem.Retryable({ kind: "rate_limited" }),
    ],
    [
      "session required",
      CustomerRequestFailure.RequestSessionRequired(),
      BookingProblem.Retryable({ kind: "session_required" }),
    ],
  ];

describe("bookingProblem", () => {
  test.each(cases)("%s", (_name, failure, problem) => {
    expect(bookingProblem(failure)).toEqual(problem);
  });
});
