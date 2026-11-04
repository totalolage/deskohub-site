import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import type {
  FulfillmentState,
  LatePaymentRecovery,
  PaymentState,
  ReservationState,
} from "@/db/schema";
import type { PaymentAttemptId } from "@/features/checkout/checkout-identifiers";
import {
  getLatePaymentStatusKind,
  toCheckoutStatusKind,
} from "./checkout-reservation-status-kind";

const now = Temporal.Instant.from("2026-11-02T10:00:00Z");
const paidMoments = {
  unknown: null,
  recent: now.subtract({ minutes: 9, seconds: 59 }),
  graceEnd: now.subtract({ minutes: 10 }),
  overdue: now.subtract({ hours: 1 }),
} as const;

const statusKind = (input: {
  readonly paymentState: PaymentState;
  readonly fulfillmentState?: FulfillmentState;
  readonly reservationState?: ReservationState;
  readonly paidAt?: keyof typeof paidMoments;
}) =>
  toCheckoutStatusKind(
    {
      paymentState: input.paymentState,
      fulfillmentState: input.fulfillmentState ?? "not_started",
      reservationState: input.reservationState ?? "held",
      paidAt: paidMoments[input.paidAt ?? "unknown"],
    },
    now
  );

describe("checkout reservation status kind", () => {
  test.each([
    ["not_started", "created"],
    ["pending", "pending"],
    ["failed", "payment_failed"],
    ["cancelled", "cancelled"],
    ["expired", "expired"],
  ] as const)(
    "reports an unpaid %s payment as %s whatever its fulfillment",
    (paymentState, expected) => {
      for (const fulfillmentState of [
        "not_started",
        "fulfilled",
        "failed",
      ] as const) {
        expect(
          statusKind({ paymentState, fulfillmentState, paidAt: "overdue" })
        ).toBe(expected);
      }
    }
  );

  test("reports a finished fulfillment the same however long ago the payment was", () => {
    for (const moment of Object.keys(paidMoments) as Array<
      keyof typeof paidMoments
    >) {
      expect(
        statusKind({
          paymentState: "paid",
          fulfillmentState: "fulfilled",
          paidAt: moment,
        })
      ).toBe("fulfilled");
      expect(
        statusKind({
          paymentState: "paid",
          fulfillmentState: "failed",
          reservationState: "confirmed",
          paidAt: moment,
        })
      ).toBe("fulfillment_failed");
    }
  });

  test.each([
    ["not_started", "held"],
    ["processing", "confirmed"],
    ["awaiting_delivery", "confirming"],
  ] as const)(
    "waits on a paid %s fulfillment of a %s reservation, delayed from the grace period's end",
    (fulfillmentState, reservationState) => {
      const kindAt = (moment: keyof typeof paidMoments) =>
        statusKind({
          paymentState: "paid",
          fulfillmentState,
          reservationState,
          paidAt: moment,
        });
      expect(kindAt("unknown")).toBe("paid_waiting_fulfillment");
      expect(kindAt("recent")).toBe("paid_waiting_fulfillment");
      expect(kindAt("graceEnd")).toBe("paid_fulfillment_delayed");
      expect(kindAt("overdue")).toBe("paid_fulfillment_delayed");
    }
  );

  test("waits on delivery once a paid reservation is confirmed, delayed from the grace period's end", () => {
    const kindAt = (moment: keyof typeof paidMoments) =>
      statusKind({
        paymentState: "paid",
        fulfillmentState: "awaiting_delivery",
        reservationState: "confirmed",
        paidAt: moment,
      });
    expect(kindAt("unknown")).toBe("paid_awaiting_delivery");
    expect(kindAt("recent")).toBe("paid_awaiting_delivery");
    expect(kindAt("graceEnd")).toBe("paid_delivery_delayed");
    expect(kindAt("overdue")).toBe("paid_delivery_delayed");
  });
});

describe("late payment status kind", () => {
  const activePaymentAttemptId = "active-attempt" as PaymentAttemptId;
  const recovery = (
    state: LatePaymentRecovery["state"],
    paymentAttemptId: string = activePaymentAttemptId
  ) =>
    ({
      state,
      paymentAttemptId: paymentAttemptId as PaymentAttemptId,
    }) as LatePaymentRecovery;

  test("takes over until recovery confirms the reservation", () => {
    const reservation = {
      activePaymentAttemptId,
      paymentState: "expired",
    } as const;
    expect(getLatePaymentStatusKind(reservation, null)).toBeUndefined();
    expect(
      getLatePaymentStatusKind(reservation, recovery("recovered"))
    ).toBeUndefined();
    expect(getLatePaymentStatusKind(reservation, recovery("pending"))).toBe(
      "late_payment_checking"
    );
    expect(getLatePaymentStatusKind(reservation, recovery("processing"))).toBe(
      "late_payment_checking"
    );
    expect(
      getLatePaymentStatusKind(reservation, recovery("refund_required"))
    ).toBe("late_payment_refund");
    expect(
      getLatePaymentStatusKind(reservation, recovery("review_required"))
    ).toBe("late_payment_review");
  });

  test("leaves a reservation its active attempt paid to an older attempt's refund", () => {
    expect(
      getLatePaymentStatusKind(
        { activePaymentAttemptId, paymentState: "paid" },
        recovery("refund_required", "older-attempt")
      )
    ).toBeUndefined();
    expect(
      getLatePaymentStatusKind(
        { activePaymentAttemptId, paymentState: "paid" },
        recovery("refund_required")
      )
    ).toBe("late_payment_refund");
    expect(
      getLatePaymentStatusKind(
        { activePaymentAttemptId, paymentState: "failed" },
        recovery("refund_required", "older-attempt")
      )
    ).toBe("late_payment_refund");
  });
});
