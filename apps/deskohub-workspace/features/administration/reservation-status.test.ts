import { describe, expect, test } from "bun:test";
import type {
  FulfillmentState,
  PaymentState,
  ReservationState,
} from "@/db/schema";
import {
  getAdministrationReservationLifecycle,
  getAdministrationReservationStatus,
} from "./reservation-status";

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
    ["held", "expired", "not_started", "Payment expired", "in_progress"],
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

  test("labels a locally abandoned payment instead of a generic cancellation", () => {
    expect(
      getAdministrationReservationStatus({
        failureCode: "payment_abandoned_after_provider_cutoff",
        fulfillmentState: "not_started",
        paymentState: "expired",
        reservationState: "cancelled",
      })
    ).toEqual({ group: "cancelled", label: "Abandoned" });
  });

  test("prioritizes a late payment requiring refund in the primary status", () => {
    expect(
      getAdministrationReservationStatus({
        failureCode: "payment_abandoned_after_provider_cutoff",
        fulfillmentState: "not_started",
        latePayment: true,
        paymentState: "expired",
        reservationState: "cancelled",
      })
    ).toEqual({ group: "attention", label: "Refund required" });
  });

  test.each([
    ["pending", "Recovering payment"],
    ["processing", "Recovering payment"],
    ["review_required", "Recovery review"],
  ] as const)("flags %s late-payment recovery", (latePaymentRecovery, label) => {
    expect(
      getAdministrationReservationStatus({
        fulfillmentState: "not_started",
        latePaymentRecovery,
        paymentState: "expired",
        reservationState: "cancelled",
      })
    ).toEqual({ group: "attention", label });
  });
});

describe("administration reservation lifecycle", () => {
  test("shows a live Dotypos cancellation instead of the stale local hold", () => {
    const input = {
      dotyposStatus: "CANCELLED" as const,
      fulfillmentState: "not_started" as const,
      paymentState: "not_started" as const,
      reservationState: "held" as const,
    };

    expect(getAdministrationReservationStatus(input)).toEqual({
      group: "in_progress",
      label: "Awaiting payment",
    });
    expect(getAdministrationReservationLifecycle(input)).toEqual({
      currentStage: "cancelled",
      label: "Cancelled in Dotypos",
      reachedStages: ["started", "held", "cancelled"],
      tone: "attention",
    });
  });

  test("keeps a fulfilled reservation complete when Dotypos was cancelled", () => {
    const input = {
      dotyposStatus: "CANCELLED" as const,
      fulfillmentState: "fulfilled" as const,
      paymentState: "paid" as const,
      reservationState: "confirmed" as const,
    };

    expect(getAdministrationReservationStatus(input)).toEqual({
      group: "complete",
      label: "Complete",
    });
    expect(getAdministrationReservationLifecycle(input).currentStage).toBe(
      "cancelled"
    );
  });

  test.each([
    ["draft", "not_started", "not_started", "started", "neutral"],
    ["held", "pending", "not_started", "held", "neutral"],
    ["held", "failed", "not_started", "held", "attention"],
    ["confirmed", "paid", "processing", "paid", "neutral"],
    ["confirmed", "paid", "failed", "paid", "attention"],
    ["confirmed", "paid", "fulfilled", "complete", "positive"],
    ["cancelling", "cancelled", "not_started", "cancelling", "neutral"],
    ["cancelled", "cancelled", "not_started", "cancelled", "neutral"],
    [
      "cancellation_failed",
      "cancelled",
      "not_started",
      "cancellation_failed",
      "attention",
    ],
    ["hold_expired", "expired", "not_started", "hold_expired", "attention"],
  ] as const)("%s / %s / %s places the journey at %s", (reservationState, paymentState, fulfillmentState, currentStage, tone) => {
    expect(
      getAdministrationReservationLifecycle({
        fulfillmentState,
        paymentState,
        reservationState,
      })
    ).toMatchObject({ currentStage, tone });
  });

  test("does not claim an expired payment cancelled a live hold", () => {
    expect(
      getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        paymentState: "expired",
        reservationState: "held",
      })
    ).toEqual({
      currentStage: "held",
      label: "Payment expired",
      reachedStages: ["started", "held"],
      tone: "attention",
    });
  });

  test("flags unconfirmed provider activity while keeping the hold", () => {
    expect(
      getAdministrationReservationLifecycle({
        failureCode: "payment_outcome_unconfirmed_before_cleanup",
        fulfillmentState: "not_started",
        paymentState: "pending",
        reservationState: "held",
      })
    ).toEqual({
      currentStage: "held",
      label: "Payment needs review",
      reachedStages: ["started", "held"],
      tone: "attention",
    });
  });

  test("shows abandonment as a completed local release", () => {
    expect(
      getAdministrationReservationLifecycle({
        failureCode: "payment_abandoned_after_provider_cutoff",
        fulfillmentState: "not_started",
        paymentState: "expired",
        reservationState: "cancelled",
      })
    ).toMatchObject({
      currentStage: "cancelled",
      label: "Payment abandoned; hold released",
      tone: "neutral",
    });
  });

  test("prioritizes a late payment requiring refund over the released hold", () => {
    expect(
      getAdministrationReservationLifecycle({
        failureCode: "payment_abandoned_after_provider_cutoff",
        fulfillmentState: "not_started",
        latePayment: true,
        paymentState: "expired",
        reservationState: "cancelled",
      })
    ).toMatchObject({
      currentStage: "cancelled",
      label: "Late payment — refund required",
      tone: "attention",
    });
  });

  test("shows queued late-payment recovery before the refund fallback", () => {
    expect(
      getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        latePaymentRecovery: "processing",
        paymentState: "expired",
        reservationState: "cancelled",
      })
    ).toMatchObject({
      label: "Late payment recovery in progress",
      tone: "attention",
    });
  });

  test("keeps an active retry held when an older attempt settles late", () => {
    expect(
      getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        latePayment: true,
        paymentState: "pending",
        reservationState: "held",
      })
    ).toEqual({
      currentStage: "held",
      label: "Awaiting payment",
      reachedStages: ["started", "held"],
      tone: "neutral",
    });
  });

  test.each([
    ["hold_expired", "hold_expired"],
    ["cancelling", "cancelling"],
    ["cancellation_failed", "cancellation_failed"],
  ] as const)("does not mark %s as cancelled", (reservationState, currentStage) => {
    const lifecycle = getAdministrationReservationLifecycle({
      fulfillmentState: "not_started",
      paymentState: "expired",
      reservationState,
    });
    expect(lifecycle.currentStage).toBe(currentStage);
    expect(lifecycle.reachedStages).not.toContain("cancelled");
  });
});
