import type { Locale } from "@/features/i18n";
import { m } from "./i18n";
import type { ReservationAccessAdministrationError } from "./reservation-access-administration.service";
import type { ReservationCancellationFailureReason } from "./reservation-administration.service";

/** The operator-facing reason a reservation cancellation stopped. */
export const getReservationCancellationErrorMessage = (
  reason: ReservationCancellationFailureReason,
  locale: Locale
) =>
  ({
    not_found: m.administrationReservationCancellationErrorNotFound,
    delivery_in_progress:
      m.administrationReservationCancellationErrorDeliveryInProgress,
    confirmation_in_progress:
      m.administrationReservationCancellationErrorConfirmationInProgress,
    invalid_state: m.administrationReservationCancellationErrorInvalidState,
    cancelled_in_dotypos:
      m.administrationReservationCancellationErrorCancelledInDotypos,
    pending_payment: m.administrationReservationCancellationErrorPendingPayment,
    changed: m.administrationReservationCancellationErrorChanged,
    reservation_unavailable:
      m.administrationReservationCancellationErrorReservationUnavailable,
    details_unavailable:
      m.administrationReservationCancellationErrorDetailsUnavailable,
    claim_failed: m.administrationReservationCancellationErrorClaimFailed,
    dotypos_failed: m.administrationReservationCancellationErrorDotyposFailed,
    record_failed: m.administrationReservationCancellationErrorRecordFailed,
  })[reason]({}, { locale });

/** The operator-facing reason door access recovery stopped. */
export const getReservationAccessErrorMessage = (
  reason: ReservationAccessAdministrationError["reason"],
  locale: Locale
) =>
  ({
    not_found: m.administrationReservationAccessErrorNotFound,
    invalid_state: m.administrationReservationAccessErrorInvalidState,
    retryable_failure:
      m.administrationReservationAccessErrorTemporarilyUnavailable,
    recovery_failed: m.administrationReservationAccessErrorRecoveryFailed,
  })[reason]({}, { locale });
