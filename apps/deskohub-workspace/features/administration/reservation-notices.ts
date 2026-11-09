import type { DotyposReservation } from "@deskohub/dotypos";
import type { LatePaymentRecoveryState, ReservationState } from "@/db/schema";
import type { AdministrationReservationStatusNote } from "./reservation-status";

/** The notice a reservation detail shows operators above its lifecycle. */
export type AdministrationReservationOperatorNotice = {
  readonly kind:
    | "late_payment_recovery_in_progress"
    | "late_payment_recovered"
    | "late_payment_recovery_review_required"
    | "late_payment_refunded"
    | "late_payment_refund_required"
    | "payment_review";
  readonly status: "error" | "success" | "warning";
};

/** The failure a payment's cleanup records when it couldn't confirm the outcome. */
const unconfirmedPaymentFailureCode =
  "payment_outcome_unconfirmed_before_cleanup";

/**
 * What the reservation's payment needs from an operator, as far as its
 * Workspace state tells.
 */
type ReservationPaymentAttention = {
  /** Workspace treats a late payment as refund required. */
  readonly latePayment: boolean;
  /** The latest late-payment recovery's state, if one ran. */
  readonly recoveryState?: LatePaymentRecoveryState;
  /** Nexi reported a refund for every payment attempt that required one. */
  readonly refunded: boolean;
  readonly failureCode: string | null;
};

const recoveryOperatorNotices: Partial<
  Record<LatePaymentRecoveryState, AdministrationReservationOperatorNotice>
> = {
  pending: { kind: "late_payment_recovery_in_progress", status: "warning" },
  processing: { kind: "late_payment_recovery_in_progress", status: "warning" },
  recovered: { kind: "late_payment_recovered", status: "success" },
  review_required: {
    kind: "late_payment_recovery_review_required",
    status: "error",
  },
};

/**
 * The operator notice of a reservation detail. A running or settled
 * late-payment recovery speaks first; a recovery that ended in a refund
 * leaves it to the late payment itself.
 */
export const getReservationOperatorNotice = ({
  failureCode,
  latePayment,
  recoveryState,
  refunded,
}: ReservationPaymentAttention): AdministrationReservationOperatorNotice | null => {
  const recoveryNotice =
    recoveryState === undefined
      ? undefined
      : recoveryOperatorNotices[recoveryState];
  if (recoveryNotice) return { ...recoveryNotice };
  if (latePayment) {
    return refunded
      ? { kind: "late_payment_refunded", status: "success" }
      : { kind: "late_payment_refund_required", status: "error" };
  }
  return failureCode === unconfirmedPaymentFailureCode
    ? { kind: "payment_review", status: "warning" }
    : null;
};

const recoveryStatusNotes: Partial<
  Record<LatePaymentRecoveryState, AdministrationReservationStatusNote>
> = {
  pending: "recovery_in_progress",
  processing: "recovery_in_progress",
  review_required: "recovery_review",
};

/** The status note a refund owes the reservation, if any. */
const getRefundStatusNote = ({
  latePayment,
  needsRefund,
  recoveryState,
  refunded,
}: ReservationPaymentAttention & {
  readonly needsRefund: boolean;
}): AdministrationReservationStatusNote | null => {
  if (needsRefund) return "needs_refund";
  const recoveryNote =
    recoveryState === undefined
      ? undefined
      : recoveryStatusNotes[recoveryState];
  if (recoveryNote) return recoveryNote;
  if (refunded) return "refunded";
  return latePayment ? "refund_required" : null;
};

/**
 * The note beside a reservation's status in lists and details. A payment that
 * still needs a refund comes first, then late-payment recovery and refunds,
 * then a payment outcome to review, and last a booking Dotypos cancelled
 * while Workspace still holds the reservation.
 */
export const getReservationStatusNote = (
  input: ReservationPaymentAttention & {
    /** Any payment attempt of the reservation, not only the latest, needs a refund. */
    readonly needsRefund: boolean;
    readonly dotyposStatus: DotyposReservation["status"] | undefined;
    readonly reservationState: ReservationState;
  }
): AdministrationReservationStatusNote | null => {
  const refundNote = getRefundStatusNote(input);
  if (refundNote) return refundNote;
  if (input.failureCode === unconfirmedPaymentFailureCode) {
    return "payment_review";
  }
  return input.dotyposStatus === "CANCELLED" &&
    input.reservationState !== "cancelled"
    ? "cancelled_in_dotypos"
    : null;
};
