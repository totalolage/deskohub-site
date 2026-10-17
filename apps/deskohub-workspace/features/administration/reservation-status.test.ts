import { describe, expect, test } from "bun:test";
import type {
  FulfillmentState,
  PaymentState,
  ReservationState,
} from "@/db/schema";
import {
  canCancelReservation,
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
  test("allows retries only after the cancellation lease expires", () => {
    const now = Temporal.Now.instant();
    expect(
      canCancelReservation(
        {
          dotyposReservationId: "dotypos-reservation",
          fulfillmentState: "processing",
          paymentState: "paid",
          reservationState: "confirmed",
          updatedAt: now,
        },
        now
      )
    ).toBe(false);
    expect(
      canCancelReservation(
        {
          dotyposReservationId: "dotypos-reservation",
          fulfillmentState: "fulfilled",
          paymentState: "paid",
          reservationState: "cancelling",
          updatedAt: now,
        },
        now
      )
    ).toBe(false);
    expect(
      canCancelReservation(
        {
          dotyposReservationId: "dotypos-reservation",
          fulfillmentState: "fulfilled",
          paymentState: "paid",
          reservationState: "cancelling",
          updatedAt: now.subtract({ minutes: 2 }),
        },
        now
      )
    ).toBe(true);
    expect(
      canCancelReservation(
        {
          dotyposReservationId: "dotypos-reservation",
          fulfillmentState: "not_started",
          paymentState: "pending",
          reservationState: "held",
          updatedAt: now,
        },
        now
      )
    ).toBe(false);
  });

  test("blocks cancellation while confirmation delivery is awaiting", () => {
    const now = Temporal.Now.instant();
    expect(
      canCancelReservation(
        {
          dotyposReservationId: "dotypos-reservation",
          fulfillmentState: "awaiting_delivery",
          paymentState: "paid",
          reservationState: "confirmed",
          updatedAt: now,
        },
        now
      )
    ).toBe(false);
  });

  test.each([
    [
      "confirmed",
      "paid",
      "failed",
      "confirmation_issue",
      "Confirmation issue",
      "attention",
    ],
    [
      "cancellation_failed",
      "failed",
      "not_started",
      "cancellation_issue",
      "Cancellation issue",
      "attention",
    ],
    ["confirmed", "paid", "fulfilled", "complete", "Complete", "complete"],
    [
      "cancelled",
      "cancelled",
      "not_started",
      "cancelled",
      "Cancelled",
      "cancelled",
    ],
    [
      "cancelling",
      "paid",
      "not_started",
      "cancelling",
      "Cancelling",
      "in_progress",
    ],
    [
      "hold_expired",
      "expired",
      "not_started",
      "expired",
      "Expired",
      "cancelled",
    ],
    [
      "confirmed",
      "paid",
      "awaiting_delivery",
      "delivering_confirmation",
      "Delivering confirmation",
      "in_progress",
    ],
    [
      "confirmed",
      "paid",
      "processing",
      "confirming",
      "Confirming",
      "in_progress",
    ],
    [
      "held",
      "pending",
      "not_started",
      "payment_pending",
      "Payment pending",
      "in_progress",
    ],
    [
      "held",
      "failed",
      "not_started",
      "payment_failed",
      "Payment failed",
      "in_progress",
    ],
    [
      "held",
      "expired",
      "not_started",
      "payment_expired",
      "Payment expired",
      "in_progress",
    ],
    [
      "held",
      "not_started",
      "not_started",
      "awaiting_payment",
      "Awaiting payment",
      "in_progress",
    ],
    [
      "draft",
      "not_started",
      "not_started",
      "starting",
      "Starting",
      "in_progress",
    ],
    [
      "creating_hold",
      "not_started",
      "not_started",
      "starting",
      "Starting",
      "in_progress",
    ],
  ] as const)(
    "%s / %s / %s becomes %s (%s)",
    (reservationState, paymentState, fulfillmentState, code, label, group) => {
      expect(status(reservationState, paymentState, fulfillmentState)).toEqual({
        group,
        code,
        label,
      });
    }
  );

  test("keeps cancellation states ahead of fulfillment states", () => {
    expect(status("cancelled", "cancelled", "failed")).toEqual({
      group: "cancelled",
      code: "cancelled",
      label: "Cancelled",
    });
    expect(status("cancellation_failed", "cancelled", "fulfilled")).toEqual({
      group: "attention",
      code: "cancellation_issue",
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
    ).toEqual({ group: "cancelled", code: "abandoned", label: "Abandoned" });
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
    ).toEqual({
      group: "attention",
      code: "refund_required",
      label: "Refund required",
    });
  });

  test("clears the refund requirement once Nexi reports the refund", () => {
    expect(
      getAdministrationReservationStatus({
        failureCode: "payment_abandoned_after_provider_cutoff",
        fulfillmentState: "not_started",
        latePayment: true,
        paymentState: "expired",
        refunded: true,
        reservationState: "cancelled",
      })
    ).toEqual({ group: "cancelled", code: "refunded", label: "Refunded" });
  });

  test.each([
    ["pending", "recovering_payment", "Recovering payment"],
    ["processing", "recovering_payment", "Recovering payment"],
    ["review_required", "recovery_review", "Recovery review"],
  ] as const)(
    "flags %s late-payment recovery",
    (latePaymentRecovery, code, label) => {
      expect(
        getAdministrationReservationStatus({
          fulfillmentState: "not_started",
          latePaymentRecovery,
          paymentState: "expired",
          reservationState: "cancelled",
        })
      ).toEqual({ group: "attention", code, label });
    }
  );
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
      code: "awaiting_payment",
      label: "Awaiting payment",
    });
    expect(getAdministrationReservationLifecycle(input)).toEqual({
      currentStage: "cancelled",
      condition: "cancelled_in_dotypos",
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
      code: "complete",
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
  ] as const)(
    "%s / %s / %s places the journey at %s",
    (reservationState, paymentState, fulfillmentState, currentStage, tone) => {
      expect(
        getAdministrationReservationLifecycle({
          fulfillmentState,
          paymentState,
          reservationState,
        })
      ).toMatchObject({ currentStage, tone });
    }
  );

  test("places awaiting confirmation delivery at the paid stage without completion", () => {
    expect(
      getAdministrationReservationLifecycle({
        fulfillmentState: "awaiting_delivery",
        paymentState: "paid",
        reservationState: "confirmed",
      })
    ).toEqual({
      currentStage: "paid",
      condition: "being_confirmed",
      label: "Being confirmed",
      reachedStages: ["started", "held", "paid"],
      tone: "neutral",
    });
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
      condition: "payment_expired",
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
      condition: "payment_needs_review",
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
      condition: "payment_abandoned",
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
      condition: "late_payment_refund_required",
      label: "Late payment — refund required",
      tone: "attention",
    });
  });

  test("settles a refunded late payment as a neutral cancellation", () => {
    expect(
      getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        latePayment: true,
        paymentState: "expired",
        refunded: true,
        reservationState: "cancelled",
      })
    ).toEqual({
      currentStage: "cancelled",
      condition: "late_payment_refunded",
      label: "Late payment refunded",
      reachedStages: ["started", "held", "cancelled"],
      tone: "neutral",
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
      condition: "late_payment_recovery_in_progress",
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
      condition: "awaiting_payment",
      label: "Awaiting payment",
      reachedStages: ["started", "held"],
      tone: "neutral",
    });
  });

  test.each([
    ["hold_expired", "hold_expired"],
    ["cancelling", "cancelling"],
    ["cancellation_failed", "cancellation_failed"],
  ] as const)(
    "does not mark %s as cancelled",
    (reservationState, currentStage) => {
      const lifecycle = getAdministrationReservationLifecycle({
        fulfillmentState: "not_started",
        paymentState: "expired",
        reservationState,
      });
      expect(lifecycle.currentStage).toBe(currentStage);
      expect(lifecycle.reachedStages).not.toContain("cancelled");
    }
  );
});
