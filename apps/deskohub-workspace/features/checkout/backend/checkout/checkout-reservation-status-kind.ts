import type { LatePaymentRecovery } from "@/db/schema";
import type { CheckoutStatusKind } from "@/features/checkout/checkout-status-kind";
import type { WorkspaceReservation } from "@/features/reservation/backend/workspace-reservation.repository";

export type CheckoutReservationStatusKind = Exclude<
  CheckoutStatusKind,
  "not_found"
>;

/**
 * Fulfillment and delivery normally finish within seconds. After this long
 * the status page stops promising automatic completion and offers support
 * instead, because the work may have stalled or the email may never arrive.
 */
const paidFulfillmentGracePeriod = { minutes: 10 };

export const toCheckoutStatusKind = (
  reservation: Pick<
    WorkspaceReservation,
    "fulfillmentState" | "paidAt" | "paymentState" | "reservationState"
  >,
  now: Temporal.Instant
): CheckoutReservationStatusKind => {
  const { paymentState } = reservation;
  if (paymentState === "paid") {
    const isOverdue =
      !!reservation.paidAt &&
      Temporal.Instant.compare(
        now,
        reservation.paidAt.add(paidFulfillmentGracePeriod)
      ) >= 0;
    switch (reservation.fulfillmentState) {
      case "fulfilled":
        return "fulfilled";
      case "failed":
        return "fulfillment_failed";
      case "awaiting_delivery":
        if (reservation.reservationState === "confirmed") {
          return isOverdue ? "paid_delivery_delayed" : "paid_awaiting_delivery";
        }
        return isOverdue
          ? "paid_fulfillment_delayed"
          : "paid_waiting_fulfillment";
      case "processing":
      case "not_started":
        return isOverdue
          ? "paid_fulfillment_delayed"
          : "paid_waiting_fulfillment";
    }
  }

  switch (paymentState) {
    case "not_started":
      return "created";
    case "pending":
      return "pending";
    case "failed":
      return "payment_failed";
    case "cancelled":
      return "cancelled";
    case "expired":
      return "expired";
  }
};

const latePaymentStatusKinds = {
  pending: "late_payment_checking",
  processing: "late_payment_checking",
  refund_required: "late_payment_refund",
  review_required: "late_payment_review",
} as const satisfies Record<
  Exclude<LatePaymentRecovery["state"], "recovered">,
  CheckoutReservationStatusKind
>;

/**
 * A late payment takes over the customer status until recovery confirms the
 * reservation. A refund for an older attempt does not hide a reservation that
 * its active attempt has paid.
 */
export const getLatePaymentStatusKind = (
  reservation: Pick<
    WorkspaceReservation,
    "activePaymentAttemptId" | "paymentState"
  >,
  recovery: LatePaymentRecovery | null
): CheckoutReservationStatusKind | undefined => {
  if (!recovery || recovery.state === "recovered") return undefined;
  if (
    recovery.paymentAttemptId !== reservation.activePaymentAttemptId &&
    reservation.paymentState === "paid"
  ) {
    return undefined;
  }
  return latePaymentStatusKinds[recovery.state];
};
