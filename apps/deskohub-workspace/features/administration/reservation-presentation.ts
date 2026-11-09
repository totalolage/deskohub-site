import type { Locale } from "@/features/i18n";
import { m } from "./i18n";
import type {
  AdministrationLifecycleCondition,
  AdministrationReservationStatusCode,
  AdministrationReservationStatusNote,
} from "./reservation-status";

export const getAdministrationReservationStatusLabel = (
  code: AdministrationReservationStatusCode,
  locale: Locale
) =>
  ({
    recovering_payment: m.administrationReservationStatusRecoveringPayment,
    recovery_review: m.administrationReservationStatusRecoveryReview,
    refunded: m.administrationReservationStatusRefunded,
    refund_required: m.administrationReservationStatusRefundRequired,
    cancellation_issue: m.administrationReservationStatusCancellationIssue,
    abandoned: m.administrationReservationStatusAbandoned,
    cancelled: m.administrationReservationStatusCancelled,
    confirmation_issue: m.administrationReservationStatusConfirmationIssue,
    cancelling: m.administrationReservationStatusCancelling,
    complete: m.administrationReservationStatusComplete,
    expired: m.administrationReservationStatusExpired,
    delivering_confirmation:
      m.administrationReservationStatusDeliveringConfirmation,
    confirming: m.administrationReservationStatusConfirming,
    payment_pending: m.administrationReservationStatusPaymentPending,
    payment_failed: m.administrationReservationStatusPaymentFailed,
    payment_expired: m.administrationReservationStatusPaymentExpired,
    awaiting_payment: m.administrationReservationStatusAwaitingPayment,
    starting: m.administrationReservationStatusStarting,
    in_progress: m.administrationReservationStatusInProgress,
  })[code]({}, { locale });

export const getAdministrationReservationStatusNoteLabel = (
  note: AdministrationReservationStatusNote,
  locale: Locale
) =>
  ({
    needs_refund: m.administrationReservationStatusNoteNeedsRefund,
    recovery_in_progress:
      m.administrationReservationStatusNoteRecoveryInProgress,
    recovery_review: m.administrationReservationStatusNoteRecoveryReview,
    refunded: m.administrationReservationStatusRefunded,
    refund_required: m.administrationReservationStatusRefundRequired,
    payment_review: m.administrationReservationStatusNotePaymentReview,
    cancelled_in_dotypos:
      m.administrationReservationStatusNoteCancelledInDotypos,
  })[note]({}, { locale });

export const getAdministrationLifecycleConditionLabel = (
  condition: AdministrationLifecycleCondition,
  locale: Locale
) =>
  ({
    late_payment_recovery_in_progress:
      m.administrationReservationLifecycleLatePaymentRecoveryInProgress,
    late_payment_recovery_review:
      m.administrationReservationLifecycleLatePaymentRecoveryReview,
    late_payment_refunded:
      m.administrationReservationLifecycleLatePaymentRefunded,
    late_payment_refund_required:
      m.administrationReservationLifecycleLatePaymentRefundRequired,
    cancellation_needs_attention:
      m.administrationReservationLifecycleCancellationNeedsAttention,
    payment_abandoned: m.administrationReservationLifecyclePaymentAbandoned,
    reservation_cancelled:
      m.administrationReservationLifecycleReservationCancelled,
    confirmation_issue: m.administrationReservationLifecycleConfirmationIssue,
    cancelled_in_dotypos:
      m.administrationReservationLifecycleCancelledInDotypos,
    cancelling: m.administrationReservationLifecycleCancelling,
    access_delivered: m.administrationReservationLifecycleAccessDelivered,
    waiting_for_cleanup: m.administrationReservationLifecycleWaitingForCleanup,
    being_confirmed: m.administrationReservationLifecycleBeingConfirmed,
    payment_needs_review:
      m.administrationReservationLifecyclePaymentNeedsReview,
    awaiting_another_payment:
      m.administrationReservationLifecycleAwaitingAnotherPayment,
    payment_expired: m.administrationReservationLifecyclePaymentExpired,
    payment_failed: m.administrationReservationLifecyclePaymentFailed,
    awaiting_payment: m.administrationReservationLifecycleAwaitingPayment,
    payment_received: m.administrationReservationLifecyclePaymentReceived,
    creating_hold: m.administrationReservationLifecycleCreatingHold,
  })[condition]({}, { locale });
