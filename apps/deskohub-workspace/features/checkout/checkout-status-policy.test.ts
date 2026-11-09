import { describe, expect, test } from "bun:test";
import {
  type CheckoutStatusKind,
  checkoutStatusKinds,
  checkoutStatusTraits,
} from "@/features/checkout/checkout-status-kind";

describe("new reservations", () => {
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
      expect(checkoutStatusTraits[status].offersNewReservation).toBe(true);
    }
  });

  test("offers to book again for another visit after fulfillment", () => {
    expect(checkoutStatusTraits.fulfilled.offersNewReservation).toBe(true);
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
      expect(checkoutStatusTraits[status].offersNewReservation).toBe(false);
    }
  });
});

describe("reservation retries", () => {
  test("retries the same selection only after a payment ended without settling", () => {
    expect(
      checkoutStatusKinds.filter(
        (status) => checkoutStatusTraits[status].offersReservationRetry
      )
    ).toEqual(["payment_failed", "cancelled", "expired"]);
  });
});

describe("reservation details email", () => {
  test("promises the details by email only for a reservation that is or will be confirmed", () => {
    expect(
      checkoutStatusKinds.filter(
        (status) => checkoutStatusTraits[status].promisesEmail
      )
    ).toEqual([
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

describe("automatic refresh", () => {
  test("waits for payment, confirmation, delivery, or late-payment recovery while progress is expected", () => {
    expect(
      checkoutStatusKinds.filter(
        (status) => checkoutStatusTraits[status].autoRefresh
      )
    ).toEqual([
      "pending",
      "paid_waiting_fulfillment",
      "paid_awaiting_delivery",
      "late_payment_checking",
    ]);
  });
});

describe("customer contact and support", () => {
  test("shows the confirmation recipient while delivery is pending without asking for support", () => {
    expect(
      checkoutStatusTraits.paid_awaiting_delivery.showsCustomerContact
    ).toBe(true);
    expect(
      checkoutStatusTraits.paid_awaiting_delivery.supportTopic
    ).toBeUndefined();
  });

  test("loads contact details for every support request and only the pending recipient besides those", () => {
    expect(
      checkoutStatusKinds.filter(
        (status) => checkoutStatusTraits[status].showsCustomerContact
      )
    ).toEqual([
      "payment_pending_delayed",
      "paid_fulfillment_delayed",
      "paid_awaiting_delivery",
      "paid_delivery_delayed",
      "fulfillment_failed",
      "late_payment_review",
    ]);
    for (const status of checkoutStatusKinds) {
      if (checkoutStatusTraits[status].supportTopic) {
        expect(checkoutStatusTraits[status].showsCustomerContact).toBe(true);
      }
    }
  });

  test("routes stalled confirmations and failed deliveries to the same support request", () => {
    for (const status of [
      "paid_fulfillment_delayed",
      "paid_delivery_delayed",
      "fulfillment_failed",
    ] as const) {
      expect(checkoutStatusTraits[status].supportTopic).toBe(
        "fulfillment_failed"
      );
    }
    expect(checkoutStatusTraits.payment_pending_delayed.supportTopic).toBe(
      "payment_pending"
    );
    expect(checkoutStatusTraits.late_payment_review.supportTopic).toBe(
      "late_payment_review"
    );
  });
});
