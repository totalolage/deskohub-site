import type {
  FulfillmentState,
  PaymentState,
  ReservationState,
  WorkspaceReservationRow,
} from "@/db/schema";

export const ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS = 60 * 1000;

export const canCancelReservation = (
  reservation: Pick<
    WorkspaceReservationRow,
    | "dotyposReservationId"
    | "fulfillmentState"
    | "paymentState"
    | "reservationState"
    | "updatedAt"
  >,
  now = Temporal.Now.instant(),
  allowPendingPayment = false
) =>
  Boolean(reservation.dotyposReservationId?.trim()) &&
  reservation.fulfillmentState !== "processing" &&
  reservation.fulfillmentState !== "awaiting_delivery" &&
  (allowPendingPayment || reservation.paymentState !== "pending") &&
  (["held", "hold_expired", "confirmed", "cancellation_failed"].includes(
    reservation.reservationState
  ) ||
    (reservation.reservationState === "cancelling" &&
      Temporal.Instant.compare(
        reservation.updatedAt,
        now.subtract({
          milliseconds: ADMINISTRATION_CANCELLATION_RETRY_AFTER_MS,
        })
      ) <= 0));

export type AdministrationStatusGroup =
  | "attention"
  | "in_progress"
  | "complete"
  | "cancelled";

// The administration API and `dhw` show these English labels; the Admin UI
// renders the code from its catalog.
const reservationStatusLabels = {
  recovering_payment: "Recovering payment",
  recovery_review: "Recovery review",
  refunded: "Refunded",
  refund_required: "Refund required",
  cancellation_issue: "Cancellation issue",
  abandoned: "Abandoned",
  cancelled: "Cancelled",
  confirmation_issue: "Confirmation issue",
  cancelling: "Cancelling",
  complete: "Complete",
  expired: "Expired",
  delivering_confirmation: "Delivering confirmation",
  confirming: "Confirming",
  payment_pending: "Payment pending",
  payment_failed: "Payment failed",
  payment_expired: "Payment expired",
  awaiting_payment: "Awaiting payment",
  starting: "Starting",
  in_progress: "In progress",
} as const;

export type AdministrationReservationStatusCode =
  keyof typeof reservationStatusLabels;

export type AdministrationReservationStatus = {
  readonly group: AdministrationStatusGroup;
  readonly code: AdministrationReservationStatusCode;
  readonly label: string;
};

const getStatus = (
  group: AdministrationStatusGroup,
  code: AdministrationReservationStatusCode
): AdministrationReservationStatus => ({
  group,
  code,
  label: reservationStatusLabels[code],
});

const reservationStatusNoteLabels = {
  needs_refund: "Needs refund",
  recovery_in_progress: "Recovery in progress",
  recovery_review: "Recovery needs review",
  refunded: "Refunded",
  refund_required: "Refund required",
  payment_review: "Payment needs review",
  cancelled_in_dotypos: "Cancelled in Dotypos",
} as const;

/** Operator work that overrides the reservation's Deskohub status in lists. */
export type AdministrationReservationStatusNote =
  keyof typeof reservationStatusNoteLabels;

/** The list fields for a status note, with the English label the API shows. */
export const getAdministrationReservationStatusNoteFields = (
  note: AdministrationReservationStatusNote | null
) => ({
  statusNote: note && reservationStatusNoteLabels[note],
  statusNoteCode: note,
});

export type ReservationStatusInput = {
  readonly dotyposStatus?: "NEW" | "CONFIRMED" | "CANCELLED";
  readonly failureCode?: string | null;
  readonly fulfillmentState: FulfillmentState;
  readonly latePayment?: boolean;
  readonly latePaymentRecovery?:
    | "pending"
    | "processing"
    | "recovered"
    | "refund_required"
    | "review_required";
  readonly paymentState: PaymentState;
  /** Nexi reported a refund for every payment attempt that required one. */
  readonly refunded?: boolean;
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

const lifecycleConditionLabels = {
  late_payment_recovery_in_progress: "Late payment recovery in progress",
  late_payment_recovery_review: "Late payment recovery needs review",
  late_payment_refunded: "Late payment refunded",
  late_payment_refund_required: "Late payment — refund required",
  cancellation_needs_attention: "Cancellation needs attention",
  payment_abandoned: "Payment abandoned; hold released",
  reservation_cancelled: "Reservation cancelled",
  confirmation_issue: "Confirmation issue",
  cancelled_in_dotypos: "Cancelled in Dotypos",
  cancelling: "Cancelling reservation",
  access_delivered: "Access delivered",
  waiting_for_cleanup: "Waiting for cleanup",
  being_confirmed: "Being confirmed",
  payment_needs_review: "Payment needs review",
  awaiting_another_payment: "Awaiting another payment",
  payment_expired: "Payment expired",
  payment_failed: "Payment failed",
  awaiting_payment: "Awaiting payment",
  payment_received: "Payment received",
  creating_hold: "Creating hold",
} as const;

/** What the reservation is waiting for or went through at its current stage. */
export type AdministrationLifecycleCondition =
  keyof typeof lifecycleConditionLabels;

const getLifecycleCondition = (condition: AdministrationLifecycleCondition) =>
  ({ condition, label: lifecycleConditionLabels[condition] }) as const;

export type AdministrationReservationLifecycle = {
  readonly currentStage: AdministrationLifecycleStage;
  readonly condition: AdministrationLifecycleCondition;
  readonly label: string;
  readonly reachedStages: readonly AdministrationLifecycleStage[];
  readonly tone: "attention" | "neutral" | "positive";
};

export const getAdministrationReservationLifecycle = (
  input: ReservationStatusInput
): AdministrationReservationLifecycle => {
  if (
    input.latePaymentRecovery === "pending" ||
    input.latePaymentRecovery === "processing"
  ) {
    return {
      currentStage:
        input.reservationState === "cancelled" ? "cancelled" : "held",
      ...getLifecycleCondition("late_payment_recovery_in_progress"),
      reachedStages: ["started", "held"],
      tone: "attention",
    };
  }
  if (input.latePaymentRecovery === "review_required") {
    return {
      currentStage: "cancelled",
      ...getLifecycleCondition("late_payment_recovery_review"),
      reachedStages: ["started", "held", "cancelled"],
      tone: "attention",
    };
  }
  if (
    input.latePayment &&
    input.refunded &&
    input.reservationState === "cancelled"
  ) {
    return {
      currentStage: "cancelled",
      ...getLifecycleCondition("late_payment_refunded"),
      reachedStages: ["started", "held", "cancelled"],
      tone: "neutral",
    };
  }
  if (input.latePayment && input.reservationState === "cancelled") {
    return {
      currentStage: "cancelled",
      ...getLifecycleCondition("late_payment_refund_required"),
      reachedStages: ["started", "held", "cancelled"],
      tone: "attention",
    };
  }
  if (input.reservationState === "cancellation_failed") {
    return {
      currentStage: "cancellation_failed",
      ...getLifecycleCondition("cancellation_needs_attention"),
      reachedStages: ["started", "held", "cancellation_failed"],
      tone: "attention",
    };
  }
  if (input.reservationState === "cancelled") {
    return {
      currentStage: "cancelled",
      ...getLifecycleCondition(
        input.failureCode === "payment_abandoned_after_provider_cutoff"
          ? "payment_abandoned"
          : "reservation_cancelled"
      ),
      reachedStages: ["started", "held", "cancelled"],
      tone: "neutral",
    };
  }
  if (input.fulfillmentState === "failed") {
    return {
      currentStage: "paid",
      ...getLifecycleCondition("confirmation_issue"),
      reachedStages: ["started", "held", "paid"],
      tone: "attention",
    };
  }
  if (input.dotyposStatus === "CANCELLED") {
    return {
      currentStage: "cancelled",
      ...getLifecycleCondition("cancelled_in_dotypos"),
      reachedStages: ["started", "held", "cancelled"],
      tone: "attention",
    };
  }
  if (input.reservationState === "cancelling") {
    return {
      currentStage: "cancelling",
      ...getLifecycleCondition("cancelling"),
      reachedStages: ["started", "held", "cancelling"],
      tone: "neutral",
    };
  }
  if (input.fulfillmentState === "fulfilled") {
    return {
      currentStage: "complete",
      ...getLifecycleCondition("access_delivered"),
      reachedStages: ["started", "held", "paid", "complete"],
      tone: "positive",
    };
  }
  if (input.reservationState === "hold_expired") {
    return {
      currentStage: "hold_expired",
      ...getLifecycleCondition("waiting_for_cleanup"),
      reachedStages: ["started", "held", "hold_expired"],
      tone: "attention",
    };
  }
  if (
    input.paymentState === "paid" ||
    input.fulfillmentState === "processing" ||
    input.fulfillmentState === "awaiting_delivery" ||
    input.reservationState === "confirming" ||
    input.reservationState === "confirmed"
  ) {
    return {
      currentStage: "paid",
      ...getLifecycleCondition("being_confirmed"),
      reachedStages: ["started", "held", "paid"],
      tone: "neutral",
    };
  }
  if (input.reservationState === "held") {
    if (input.failureCode === "payment_outcome_unconfirmed_before_cleanup") {
      return {
        currentStage: "held",
        ...getLifecycleCondition("payment_needs_review"),
        reachedStages: ["started", "held"],
        tone: "attention",
      };
    }
    const paymentIssue =
      input.paymentState === "failed" || input.paymentState === "expired";
    return {
      currentStage: "held",
      ...getLifecycleCondition(
        (
          {
            cancelled: "awaiting_another_payment",
            expired: "payment_expired",
            failed: "payment_failed",
            not_started: "awaiting_payment",
            paid: "payment_received",
            pending: "awaiting_payment",
          } as const
        )[input.paymentState]
      ),
      reachedStages: ["started", "held"],
      tone: paymentIssue ? "attention" : "neutral",
    };
  }
  return {
    currentStage: "started",
    ...getLifecycleCondition("creating_hold"),
    reachedStages: ["started"],
    tone: "neutral",
  };
};

export const getAdministrationReservationStatus = (
  input: ReservationStatusInput
): AdministrationReservationStatus => {
  if (
    input.latePaymentRecovery === "pending" ||
    input.latePaymentRecovery === "processing"
  ) {
    return getStatus("attention", "recovering_payment");
  }
  if (input.latePaymentRecovery === "review_required") {
    return getStatus("attention", "recovery_review");
  }
  if (input.latePayment && input.refunded) {
    return getStatus("cancelled", "refunded");
  }
  if (input.latePayment) {
    return getStatus("attention", "refund_required");
  }
  if (input.reservationState === "cancellation_failed") {
    return getStatus("attention", "cancellation_issue");
  }
  if (input.reservationState === "cancelled") {
    return getStatus(
      "cancelled",
      input.failureCode === "payment_abandoned_after_provider_cutoff"
        ? "abandoned"
        : "cancelled"
    );
  }
  if (input.fulfillmentState === "failed") {
    return getStatus("attention", "confirmation_issue");
  }
  if (input.reservationState === "cancelling") {
    return getStatus("in_progress", "cancelling");
  }
  if (input.fulfillmentState === "fulfilled") {
    return getStatus("complete", "complete");
  }
  if (input.reservationState === "hold_expired") {
    return getStatus("cancelled", "expired");
  }
  if (input.fulfillmentState === "awaiting_delivery") {
    return getStatus("in_progress", "delivering_confirmation");
  }
  if (
    input.paymentState === "paid" ||
    input.fulfillmentState === "processing" ||
    input.reservationState === "confirming" ||
    input.reservationState === "confirmed"
  ) {
    return getStatus("in_progress", "confirming");
  }
  if (input.paymentState === "pending") {
    return getStatus("in_progress", "payment_pending");
  }
  if (input.paymentState === "failed" && input.reservationState === "held") {
    return getStatus("in_progress", "payment_failed");
  }
  if (input.paymentState === "expired" && input.reservationState === "held") {
    return getStatus("in_progress", "payment_expired");
  }
  if (
    input.reservationState === "held" &&
    (input.paymentState === "not_started" || input.paymentState === "cancelled")
  ) {
    return getStatus("in_progress", "awaiting_payment");
  }
  if (
    input.reservationState === "draft" ||
    input.reservationState === "creating_hold"
  ) {
    return getStatus("in_progress", "starting");
  }

  return getStatus("in_progress", "in_progress");
};
