import type {
  FulfillmentState,
  PaymentState,
  ReservationState,
} from "@/db/schema";

export type AdministrationStatusGroup =
  | "attention"
  | "in_progress"
  | "complete"
  | "cancelled";

export type AdministrationReservationStatus = {
  readonly group: AdministrationStatusGroup;
  readonly label: string;
};

export type ReservationStatusInput = {
  readonly fulfillmentState: FulfillmentState;
  readonly paymentState: PaymentState;
  readonly reservationState: ReservationState;
};

export type AdministrationLifecycleStage =
  | "started"
  | "held"
  | "paid"
  | "complete"
  | "hold_expired"
  | "cancelling"
  | "cancellation_failed"
  | "cancelled";

export type AdministrationReservationLifecycle = {
  readonly currentStage: AdministrationLifecycleStage;
  readonly label: string;
  readonly reachedStages: readonly AdministrationLifecycleStage[];
  readonly tone: "attention" | "neutral" | "positive";
};

export const getAdministrationReservationLifecycle = (
  input: ReservationStatusInput
): AdministrationReservationLifecycle => {
  if (input.fulfillmentState === "failed") {
    return {
      currentStage: "paid",
      label: "Confirmation issue",
      reachedStages: ["started", "held", "paid"],
      tone: "attention",
    };
  }
  if (input.reservationState === "cancellation_failed") {
    return {
      currentStage: "cancellation_failed",
      label: "Release needs attention",
      reachedStages: ["started", "held", "cancellation_failed"],
      tone: "attention",
    };
  }
  if (input.fulfillmentState === "fulfilled") {
    return {
      currentStage: "complete",
      label: "Access delivered",
      reachedStages: ["started", "held", "paid", "complete"],
      tone: "positive",
    };
  }
  if (input.reservationState === "cancelled") {
    return {
      currentStage: "cancelled",
      label: "Hold released",
      reachedStages: ["started", "held", "cancelled"],
      tone: "neutral",
    };
  }
  if (input.reservationState === "cancelling") {
    return {
      currentStage: "cancelling",
      label: "Releasing hold",
      reachedStages: ["started", "held", "cancelling"],
      tone: "neutral",
    };
  }
  if (input.reservationState === "hold_expired") {
    return {
      currentStage: "hold_expired",
      label: "Waiting for cleanup",
      reachedStages: ["started", "held", "hold_expired"],
      tone: "attention",
    };
  }
  if (
    input.paymentState === "paid" ||
    input.fulfillmentState === "processing" ||
    input.reservationState === "confirming" ||
    input.reservationState === "confirmed"
  ) {
    return {
      currentStage: "paid",
      label: "Being confirmed",
      reachedStages: ["started", "held", "paid"],
      tone: "neutral",
    };
  }
  if (input.reservationState === "held") {
    const paymentIssue =
      input.paymentState === "failed" || input.paymentState === "expired";
    return {
      currentStage: "held",
      label: {
        cancelled: "Awaiting another payment",
        expired: "Payment expired",
        failed: "Payment failed",
        not_started: "Awaiting payment",
        paid: "Payment received",
        pending: "Awaiting payment",
      }[input.paymentState],
      reachedStages: ["started", "held"],
      tone: paymentIssue ? "attention" : "neutral",
    };
  }
  return {
    currentStage: "started",
    label: "Creating hold",
    reachedStages: ["started"],
    tone: "neutral",
  };
};

export const getAdministrationReservationStatus = (
  input: ReservationStatusInput
): AdministrationReservationStatus => {
  if (input.fulfillmentState === "failed") {
    return { group: "attention", label: "Confirmation issue" };
  }
  if (input.reservationState === "cancellation_failed") {
    return { group: "attention", label: "Cancellation issue" };
  }
  if (input.fulfillmentState === "fulfilled") {
    return { group: "complete", label: "Complete" };
  }
  if (input.reservationState === "cancelled") {
    return { group: "cancelled", label: "Cancelled" };
  }
  if (input.reservationState === "cancelling") {
    return { group: "in_progress", label: "Cancelling" };
  }
  if (input.reservationState === "hold_expired") {
    return { group: "cancelled", label: "Expired" };
  }
  if (
    input.paymentState === "paid" ||
    input.fulfillmentState === "processing" ||
    input.reservationState === "confirming" ||
    input.reservationState === "confirmed"
  ) {
    return { group: "in_progress", label: "Confirming" };
  }
  if (input.paymentState === "pending") {
    return { group: "in_progress", label: "Payment pending" };
  }
  if (input.paymentState === "failed" && input.reservationState === "held") {
    return { group: "in_progress", label: "Payment failed" };
  }
  if (input.paymentState === "expired" && input.reservationState === "held") {
    return { group: "in_progress", label: "Payment expired" };
  }
  if (
    input.reservationState === "held" &&
    (input.paymentState === "not_started" || input.paymentState === "cancelled")
  ) {
    return { group: "in_progress", label: "Awaiting payment" };
  }
  if (
    input.reservationState === "draft" ||
    input.reservationState === "creating_hold"
  ) {
    return { group: "in_progress", label: "Starting" };
  }

  return { group: "in_progress", label: "In progress" };
};
