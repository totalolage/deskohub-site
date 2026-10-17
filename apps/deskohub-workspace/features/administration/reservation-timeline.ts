import type { Locale } from "@/features/i18n";
import { m } from "./i18n";

/**
 * A reservation history entry from the reservation workflow, late-payment
 * recovery or PostHog. The Admin UI renders its copy from this; the
 * administration API keeps the item's English title and description.
 */
export type AdministrationReservationTimelineEvent = {
  readonly source: "reservation";
  readonly kind:
    | "workflow_created"
    | "reservation_held"
    | "payment_recorded"
    | "payment_started"
    | "payment_completed"
    | "payment_unsuccessful"
    | "payment_failed"
    | "reservation_confirmed"
    | "access_delivered"
    | "access_sent"
    | "confirmation_failed"
    | "hold_expired"
    | "hold_cancelled"
    | "reservation_cancelled"
    | "late_payment"
    | "late_payment_recovery_started"
    | "late_payment_recovered"
    | "late_payment_recovery_refund_required"
    | "late_payment_recovery_review_required";
};

export const getAdministrationReservationTimelineCopy = (
  event: AdministrationReservationTimelineEvent,
  locale: Locale
) => {
  const { title, description } = {
    workflow_created: {
      title: m.administrationReservationTimelineWorkflowCreatedTitle,
      description:
        m.administrationReservationTimelineWorkflowCreatedDescription,
    },
    reservation_held: {
      title: m.administrationReservationTimelineHeldTitle,
      description: m.administrationReservationTimelineHeldDescription,
    },
    payment_recorded: {
      title: m.administrationReservationTimelinePaymentRecordedTitle,
      description:
        m.administrationReservationTimelinePaymentRecordedDescription,
    },
    payment_started: {
      title: m.administrationReservationTimelinePaymentStartedTitle,
      description: m.administrationReservationTimelinePaymentStartedDescription,
    },
    payment_completed: {
      title: m.administrationReservationTimelinePaymentRecordedTitle,
      description:
        m.administrationReservationTimelinePaymentCompletedDescription,
    },
    payment_unsuccessful: {
      title: m.administrationReservationTimelinePaymentUnsuccessfulTitle,
      description:
        m.administrationReservationTimelinePaymentUnsuccessfulDescription,
    },
    payment_failed: {
      title: m.administrationReservationTimelinePaymentFailedTitle,
      description: m.administrationReservationTimelinePaymentFailedDescription,
    },
    reservation_confirmed: {
      title: m.administrationReservationTimelineConfirmedTitle,
      description: m.administrationReservationTimelineConfirmedDescription,
    },
    access_delivered: {
      title: m.administrationReservationTimelineAccessSentTitle,
      description:
        m.administrationReservationTimelineAccessDeliveredDescription,
    },
    access_sent: {
      title: m.administrationReservationTimelineAccessSentTitle,
      description: m.administrationReservationTimelineAccessSentDescription,
    },
    confirmation_failed: {
      title: m.administrationReservationTimelineConfirmationFailedTitle,
      description:
        m.administrationReservationTimelineConfirmationFailedDescription,
    },
    hold_expired: {
      title: m.administrationReservationTimelineHoldExpiredTitle,
      description: m.administrationReservationTimelineHoldExpiredDescription,
    },
    hold_cancelled: {
      title: m.administrationReservationTimelineCancelledTitle,
      description: m.administrationReservationTimelineHoldCancelledDescription,
    },
    reservation_cancelled: {
      title: m.administrationReservationTimelineCancelledTitle,
      description: m.administrationReservationTimelineCancelledDescription,
    },
    late_payment: {
      title: m.administrationReservationLifecycleLatePaymentRefundRequired,
      description: m.administrationReservationTimelineLatePaymentDescription,
    },
    late_payment_recovery_started: {
      title: m.administrationReservationTimelineRecoveryStartedTitle,
      description:
        m.administrationReservationTimelineRecoveryStartedDescription,
    },
    late_payment_recovered: {
      title: m.administrationReservationTimelineRecoveredTitle,
      description: m.administrationReservationNoticeRecovered,
    },
    late_payment_recovery_refund_required: {
      title: m.administrationReservationLifecycleLatePaymentRefundRequired,
      description:
        m.administrationReservationTimelineRecoveryRefundRequiredDescription,
    },
    late_payment_recovery_review_required: {
      title: m.administrationReservationLifecycleLatePaymentRecoveryReview,
      description: m.administrationReservationTimelineRecoveryReviewDescription,
    },
  }[event.kind];
  return {
    title: title({}, { locale }),
    description: description({}, { locale }),
  };
};
