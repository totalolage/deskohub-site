import { describe, expect, test } from "bun:test";
import { CustomerOrderStatus } from "@deskohub/workspace-customer-api";
import {
  offersAccessLink,
  offersInvoice,
  orderStatusTraits,
} from "./order-status-kind";

// The website's `checkoutStatusTraits` (origin/main
// apps/deskohub-workspace/features/checkout/checkout-status-kind.ts) for the
// traits the app shares: [paid, offersNewReservation, supportTopic].
const siteTraits = {
  created: [false, true, undefined],
  pending: [false, false, undefined],
  payment_pending_delayed: [false, false, "payment_pending"],
  paid_waiting_fulfillment: [true, false, undefined],
  paid_fulfillment_delayed: [true, false, "fulfillment_failed"],
  paid_awaiting_delivery: [true, false, undefined],
  paid_delivery_delayed: [true, false, "fulfillment_failed"],
  fulfilled: [true, true, undefined],
  fulfillment_failed: [true, false, "fulfillment_failed"],
  payment_failed: [false, true, undefined],
  cancelled: [false, true, undefined],
  expired: [false, true, undefined],
  late_payment_checking: [false, false, undefined],
  late_payment_refund: [false, true, undefined],
  late_payment_review: [false, false, "late_payment_review"],
} as const;

describe("orderStatusTraits", () => {
  test.each([...CustomerOrderStatus.literals])(
    "%s mirrors the website's status page",
    (status) => {
      const { paid, offersNewReservation, supportTopic } =
        orderStatusTraits[status];
      expect([paid, offersNewReservation, supportTopic]).toEqual([
        ...siteTraits[status],
      ]);
    }
  );

  test("a delayed or failed status is never framed as plain information", () => {
    for (const status of CustomerOrderStatus.literals) {
      if (orderStatusTraits[status].supportTopic !== undefined) {
        expect(orderStatusTraits[status].tone).not.toBe("info");
      }
    }
  });
});

describe("order actions", () => {
  test("offers the invoice exactly for paid statuses", () => {
    expect(
      CustomerOrderStatus.literals.filter((status) => offersInvoice({ status }))
    ).toEqual([
      "paid_waiting_fulfillment",
      "paid_fulfillment_delayed",
      "paid_awaiting_delivery",
      "paid_delivery_delayed",
      "fulfilled",
      "fulfillment_failed",
    ]);
  });

  test("links a fulfilled order to its door code", () => {
    expect(offersAccessLink({ status: "fulfilled" })).toBe(true);
    expect(
      CustomerOrderStatus.literals.filter((status) =>
        offersAccessLink({ status })
      )
    ).toEqual(["fulfilled"]);
  });

  test("never links a review sandbox order to a door code", () => {
    expect(offersAccessLink({ status: "fulfilled", reviewSandbox: true })).toBe(
      false
    );
  });
});
