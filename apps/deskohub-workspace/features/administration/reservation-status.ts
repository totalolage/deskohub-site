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

const isLatePaymentRecoveryInProgress = (input: ReservationStatusInput) =>
  input.latePaymentRecovery === "pending" ||
  input.latePaymentRecovery === "processing";

const isLatePaymentRecoveryReview = (input: ReservationStatusInput) =>
  input.latePaymentRecovery === "review_required";

const isRefundedLatePayment = (input: ReservationStatusInput) =>
  Boolean(input.latePayment && input.refunded);

const isLatePayment = (input: ReservationStatusInput) =>
  Boolean(input.latePayment);

const isReservation =
  (state: ReservationState) => (input: ReservationStatusInput) =>
    input.reservationState === state;

const isFulfillment =
  (state: FulfillmentState) => (input: ReservationStatusInput) =>
    input.fulfillmentState === state;

const isCancelled = isReservation("cancelled");

const isHeld = isReservation("held");

/** The customer gave up on paying after the provider's cutoff, so the hold was released. */
const isAbandonedAfterProviderCutoff = (input: ReservationStatusInput) =>
  isCancelled(input) &&
  input.failureCode === "payment_abandoned_after_provider_cutoff";

/** The payment went through, or confirming the reservation has begun. */
const isPastPayment = (input: ReservationStatusInput) =>
  input.paymentState === "paid" ||
  input.fulfillmentState === "processing" ||
  input.fulfillmentState === "awaiting_delivery" ||
  input.reservationState === "confirming" ||
  input.reservationState === "confirmed";

type ReservationStatusRule<Result> = {
  readonly applies: (input: ReservationStatusInput) => boolean;
  readonly result: (input: ReservationStatusInput) => Result;
};

/** The result of the first rule that applies, in order, else the fallback. */
const applyFirstRule = <Result>(
  rules: readonly ReservationStatusRule<Result>[],
  fallback: () => Result,
  input: ReservationStatusInput
) => (rules.find((rule) => rule.applies(input))?.result ?? fallback)(input);

const getLifecycle = (
  currentStage: AdministrationLifecycleStage,
  condition: AdministrationLifecycleCondition,
  reachedStages: readonly AdministrationLifecycleStage[],
  tone: AdministrationReservationLifecycle["tone"]
): AdministrationReservationLifecycle => ({
  currentStage,
  ...getLifecycleCondition(condition),
  reachedStages,
  tone,
});

/** What a held reservation waits for, by the state of its latest payment. */
const heldPaymentConditions = {
  cancelled: "awaiting_another_payment",
  expired: "payment_expired",
  failed: "payment_failed",
  not_started: "awaiting_payment",
  paid: "payment_received",
  pending: "awaiting_payment",
} as const satisfies Record<PaymentState, AdministrationLifecycleCondition>;

const getHeldLifecycle = (input: ReservationStatusInput) =>
  getLifecycle(
    "held",
    heldPaymentConditions[input.paymentState],
    ["started", "held"],
    input.paymentState === "failed" || input.paymentState === "expired"
      ? "attention"
      : "neutral"
  );

const lifecycleRules: readonly ReservationStatusRule<AdministrationReservationLifecycle>[] =
  [
    {
      applies: isLatePaymentRecoveryInProgress,
      result: (input) =>
        getLifecycle(
          isCancelled(input) ? "cancelled" : "held",
          "late_payment_recovery_in_progress",
          ["started", "held"],
          "attention"
        ),
    },
    {
      applies: isLatePaymentRecoveryReview,
      result: () =>
        getLifecycle(
          "cancelled",
          "late_payment_recovery_review",
          ["started", "held", "cancelled"],
          "attention"
        ),
    },
    {
      applies: (input) => isRefundedLatePayment(input) && isCancelled(input),
      result: () =>
        getLifecycle(
          "cancelled",
          "late_payment_refunded",
          ["started", "held", "cancelled"],
          "neutral"
        ),
    },
    {
      applies: (input) => isLatePayment(input) && isCancelled(input),
      result: () =>
        getLifecycle(
          "cancelled",
          "late_payment_refund_required",
          ["started", "held", "cancelled"],
          "attention"
        ),
    },
    {
      applies: isReservation("cancellation_failed"),
      result: () =>
        getLifecycle(
          "cancellation_failed",
          "cancellation_needs_attention",
          ["started", "held", "cancellation_failed"],
          "attention"
        ),
    },
    {
      applies: isAbandonedAfterProviderCutoff,
      result: () =>
        getLifecycle(
          "cancelled",
          "payment_abandoned",
          ["started", "held", "cancelled"],
          "neutral"
        ),
    },
    {
      applies: isCancelled,
      result: () =>
        getLifecycle(
          "cancelled",
          "reservation_cancelled",
          ["started", "held", "cancelled"],
          "neutral"
        ),
    },
    {
      applies: isFulfillment("failed"),
      result: () =>
        getLifecycle(
          "paid",
          "confirmation_issue",
          ["started", "held", "paid"],
          "attention"
        ),
    },
    {
      applies: (input) => input.dotyposStatus === "CANCELLED",
      result: () =>
        getLifecycle(
          "cancelled",
          "cancelled_in_dotypos",
          ["started", "held", "cancelled"],
          "attention"
        ),
    },
    {
      applies: isReservation("cancelling"),
      result: () =>
        getLifecycle(
          "cancelling",
          "cancelling",
          ["started", "held", "cancelling"],
          "neutral"
        ),
    },
    {
      applies: isFulfillment("fulfilled"),
      result: () =>
        getLifecycle(
          "complete",
          "access_delivered",
          ["started", "held", "paid", "complete"],
          "positive"
        ),
    },
    {
      applies: isReservation("hold_expired"),
      result: () =>
        getLifecycle(
          "hold_expired",
          "waiting_for_cleanup",
          ["started", "held", "hold_expired"],
          "attention"
        ),
    },
    {
      applies: isPastPayment,
      result: () =>
        getLifecycle(
          "paid",
          "being_confirmed",
          ["started", "held", "paid"],
          "neutral"
        ),
    },
    {
      applies: (input) =>
        isHeld(input) &&
        input.failureCode === "payment_outcome_unconfirmed_before_cleanup",
      result: () =>
        getLifecycle(
          "held",
          "payment_needs_review",
          ["started", "held"],
          "attention"
        ),
    },
    { applies: isHeld, result: getHeldLifecycle },
  ];

export const getAdministrationReservationLifecycle = (
  input: ReservationStatusInput
): AdministrationReservationLifecycle =>
  applyFirstRule(
    lifecycleRules,
    () => getLifecycle("started", "creating_hold", ["started"], "neutral"),
    input
  );

const statusRule = (
  applies: (input: ReservationStatusInput) => boolean,
  group: AdministrationStatusGroup,
  code: AdministrationReservationStatusCode
): ReservationStatusRule<AdministrationReservationStatus> => ({
  applies,
  result: () => getStatus(group, code),
});

const isHeldWithPayment =
  (...states: readonly PaymentState[]) =>
  (input: ReservationStatusInput) =>
    isHeld(input) && states.includes(input.paymentState);

const statusRules: readonly ReservationStatusRule<AdministrationReservationStatus>[] =
  [
    statusRule(
      isLatePaymentRecoveryInProgress,
      "attention",
      "recovering_payment"
    ),
    statusRule(isLatePaymentRecoveryReview, "attention", "recovery_review"),
    statusRule(isRefundedLatePayment, "cancelled", "refunded"),
    statusRule(isLatePayment, "attention", "refund_required"),
    statusRule(
      isReservation("cancellation_failed"),
      "attention",
      "cancellation_issue"
    ),
    statusRule(isAbandonedAfterProviderCutoff, "cancelled", "abandoned"),
    statusRule(isCancelled, "cancelled", "cancelled"),
    statusRule(isFulfillment("failed"), "attention", "confirmation_issue"),
    statusRule(isReservation("cancelling"), "in_progress", "cancelling"),
    statusRule(isFulfillment("fulfilled"), "complete", "complete"),
    statusRule(isReservation("hold_expired"), "cancelled", "expired"),
    statusRule(
      isFulfillment("awaiting_delivery"),
      "in_progress",
      "delivering_confirmation"
    ),
    statusRule(isPastPayment, "in_progress", "confirming"),
    statusRule(
      (input) => input.paymentState === "pending",
      "in_progress",
      "payment_pending"
    ),
    statusRule(isHeldWithPayment("failed"), "in_progress", "payment_failed"),
    statusRule(isHeldWithPayment("expired"), "in_progress", "payment_expired"),
    statusRule(
      isHeldWithPayment("not_started", "cancelled"),
      "in_progress",
      "awaiting_payment"
    ),
    statusRule(
      (input) =>
        input.reservationState === "draft" ||
        input.reservationState === "creating_hold",
      "in_progress",
      "starting"
    ),
  ];

export const getAdministrationReservationStatus = (
  input: ReservationStatusInput
): AdministrationReservationStatus =>
  applyFirstRule(
    statusRules,
    () => getStatus("in_progress", "in_progress"),
    input
  );
