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
  if (
    input.reservationState === "hold_expired" ||
    input.paymentState === "expired"
  ) {
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
