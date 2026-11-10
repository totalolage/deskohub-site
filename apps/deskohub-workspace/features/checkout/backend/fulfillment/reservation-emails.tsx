import { Effect } from "effect";
import {
  CustomerReservationEmail,
  type CustomerReservationEmailProps,
  customerReservationEmailSubject,
} from "@/emails/customer-reservation";
import {
  ReservationAuthorEmail,
  type ReservationAuthorEmailProps,
  reservationAuthorEmailSubject,
} from "@/emails/reservation-author";
import {
  ReservationCancellationEmail,
  type ReservationCancellationEmailProps,
  reservationCancellationEmailSubject,
} from "@/emails/reservation-cancellation";
import {
  ReservationNotificationEmail,
  type ReservationNotificationEmailProps,
  reservationNotificationEmailSubject,
} from "@/emails/reservation-notification";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { internalWorkspaceEmailSubject } from "@/shared/backend/email/workspace-email-recipients";

/** Renders a paid reservation's confirmation for its customer. */
export const renderCustomerReservationEmail = (
  props: CustomerReservationEmailProps
) =>
  Effect.map(
    renderWorkspaceEmail(<CustomerReservationEmail {...props} />),
    (rendered) => ({
      subject: customerReservationEmailSubject(props),
      ...rendered,
    })
  );

/** Renders the confirmation for an author who booked for someone else. */
export const renderReservationAuthorEmail = (
  props: ReservationAuthorEmailProps
) =>
  Effect.map(
    renderWorkspaceEmail(<ReservationAuthorEmail {...props} />),
    (rendered) => ({
      subject: reservationAuthorEmailSubject(props),
      ...rendered,
    })
  );

/** Renders the staff notification of a paid reservation. */
export const renderReservationNotificationEmail = (
  props: ReservationNotificationEmailProps
) =>
  Effect.map(
    renderWorkspaceEmail(<ReservationNotificationEmail {...props} />),
    (rendered) => ({
      subject: internalWorkspaceEmailSubject(
        reservationNotificationEmailSubject(props)
      ),
      ...rendered,
    })
  );

/** Renders the customer's notice that their reservation was cancelled. */
export const renderReservationCancellationEmail = (
  props: ReservationCancellationEmailProps
) =>
  Effect.map(
    renderWorkspaceEmail(<ReservationCancellationEmail {...props} />),
    (rendered) => ({
      subject: reservationCancellationEmailSubject(props),
      ...rendered,
    })
  );
