import { describe, expect, test } from "bun:test";
import type {
  FulfillmentState,
  PaymentState,
  ReservationState,
} from "@/db/schema";
import { getAdministrationReservationStatus } from "./reservation-status";

const status = (
  reservationState: ReservationState,
  paymentState: PaymentState,
  fulfillmentState: FulfillmentState
) =>
  getAdministrationReservationStatus({
    fulfillmentState,
    paymentState,
    reservationState,
  });

describe("administration reservation status", () => {
  test.each([
    ["confirmed", "paid", "failed", "Confirmation issue", "attention"],
    [
      "cancellation_failed",
      "failed",
      "not_started",
      "Cancellation issue",
      "attention",
    ],
    ["confirmed", "paid", "fulfilled", "Complete", "complete"],
    ["cancelled", "cancelled", "not_started", "Cancelled", "cancelled"],
    ["cancelling", "paid", "not_started", "Cancelling", "in_progress"],
    ["hold_expired", "expired", "not_started", "Expired", "cancelled"],
    ["confirmed", "paid", "processing", "Confirming", "in_progress"],
    ["held", "pending", "not_started", "Payment pending", "in_progress"],
    ["held", "failed", "not_started", "Payment failed", "in_progress"],
    ["held", "not_started", "not_started", "Awaiting payment", "in_progress"],
    ["draft", "not_started", "not_started", "Starting", "in_progress"],
    ["creating_hold", "not_started", "not_started", "Starting", "in_progress"],
  ] as const)("%s / %s / %s becomes %s", (reservationState, paymentState, fulfillmentState, label, group) => {
    expect(status(reservationState, paymentState, fulfillmentState)).toEqual({
      group,
      label,
    });
  });

  test("keeps attention states ahead of terminal states", () => {
    expect(status("cancelled", "cancelled", "failed")).toEqual({
      group: "attention",
      label: "Confirmation issue",
    });
    expect(status("cancellation_failed", "cancelled", "fulfilled")).toEqual({
      group: "attention",
      label: "Cancellation issue",
    });
  });
});
