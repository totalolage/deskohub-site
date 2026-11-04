import type { LatePaymentRecovery, PaymentState } from "@/db/schema";
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

type StatusKindReservation = Pick<
  WorkspaceReservation,
  "fulfillmentState" | "paidAt" | "paymentState" | "reservationState"
>;

export const toCheckoutStatusKind = (
  reservation: StatusKindReservation,
  now: Temporal.Instant
): CheckoutReservationStatusKind =>
  reservation.paymentState === "paid"
    ? getPaidStatusKind(reservation, now)
    : unpaidStatusKinds[reservation.paymentState];

const unpaidStatusKinds = {
  not_started: "created",
  pending: "pending",
  failed: "payment_failed",
  cancelled: "cancelled",
  expired: "expired",
} as const satisfies Record<
  Exclude<PaymentState, "paid">,
  CheckoutReservationStatusKind
>;

const getPaidStatusKind = (
  reservation: StatusKindReservation,
  now: Temporal.Instant
): CheckoutReservationStatusKind => {
  const isOverdue = isPaidFulfillmentOverdue(reservation, now);
  switch (reservation.fulfillmentState) {
    case "fulfilled":
      return "fulfilled";
    case "failed":
      return "fulfillment_failed";
    case "awaiting_delivery":
      if (reservation.reservationState === "confirmed") {
        return isOverdue ? "paid_delivery_delayed" : "paid_awaiting_delivery";
      }
      return getPaidWaitingStatusKind(isOverdue);
    case "processing":
    case "not_started":
      return getPaidWaitingStatusKind(isOverdue);
  }
};

const isPaidFulfillmentOverdue = (
  reservation: Pick<WorkspaceReservation, "paidAt">,
  now: Temporal.Instant
) =>
  !!reservation.paidAt &&
  Temporal.Instant.compare(
    now,
    reservation.paidAt.add(paidFulfillmentGracePeriod)
  ) >= 0;

const getPaidWaitingStatusKind = (isOverdue: boolean) =>
  isOverdue ? "paid_fulfillment_delayed" : "paid_waiting_fulfillment";

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
