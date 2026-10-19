import { describe, expect, test } from "bun:test";
import type { CheckoutStatusKind } from "@/features/checkout/backend/checkout";
import {
  shouldOfferNewReservation,
  shouldOfferReservationRetry,
  shouldPromiseReservationDetailsEmail,
} from "@/features/checkout/checkout-status-policy";

describe("shouldOfferNewReservation", () => {
  test("starts a new reservation only when the checkout holds no live paid reservation", () => {
    const withoutLivePaidReservation: CheckoutStatusKind[] = [
      "not_found",
      "created",
      "payment_failed",
      "cancelled",
      "expired",
      "late_payment_refund",
    ];

    for (const status of withoutLivePaidReservation) {
      expect(shouldOfferNewReservation(status)).toBe(true);
    }
  });

  test("offers to book again for another visit after fulfillment", () => {
    expect(shouldOfferNewReservation("fulfilled")).toBe(true);
  });

  test("never invites another purchase while a payment is processing or a paid reservation is live", () => {
    const withLivePaidReservation: CheckoutStatusKind[] = [
      "pending",
      "payment_pending_delayed",
      "paid_waiting_fulfillment",
      "paid_fulfillment_delayed",
      "paid_awaiting_delivery",
      "paid_delivery_delayed",
      "fulfillment_failed",
      "late_payment_checking",
      "late_payment_review",
    ];

    for (const status of withLivePaidReservation) {
      expect(shouldOfferNewReservation(status)).toBe(false);
    }
  });
});

const allStatuses: CheckoutStatusKind[] = [
  "not_found",
  "created",
  "pending",
  "payment_pending_delayed",
  "paid_waiting_fulfillment",
  "paid_fulfillment_delayed",
  "paid_awaiting_delivery",
  "paid_delivery_delayed",
  "fulfilled",
  "fulfillment_failed",
  "payment_failed",
  "cancelled",
  "expired",
  "late_payment_checking",
  "late_payment_refund",
  "late_payment_review",
];

describe("shouldOfferReservationRetry", () => {
  test("retries the same selection only after a payment ended without settling", () => {
    expect(allStatuses.filter(shouldOfferReservationRetry)).toEqual([
      "payment_failed",
      "cancelled",
      "expired",
    ]);
  });
});

describe("shouldPromiseReservationDetailsEmail", () => {
  test("promises the details by email only for a reservation that is or will be confirmed", () => {
    expect(allStatuses.filter(shouldPromiseReservationDetailsEmail)).toEqual([
      "pending",
      "payment_pending_delayed",
      "paid_waiting_fulfillment",
      "paid_fulfillment_delayed",
      "paid_awaiting_delivery",
      "paid_delivery_delayed",
      "fulfilled",
    ]);
  });
});
