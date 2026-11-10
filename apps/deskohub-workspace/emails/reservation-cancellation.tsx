import { type Locale, m } from "@/features/i18n";
import {
  type ReservationEmailReservation,
  reservationEmailDetails,
} from "./_components/reservation-email-details";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { reservationCancellationPreviewProps } from "./_fixtures/preview-props";

export type ReservationCancellationEmailProps = {
  readonly locale: Locale;
  readonly reservation: ReservationEmailReservation;
};

/** The subject, which the inbox also previews. */
export const reservationCancellationEmailSubject = ({
  locale,
}: Pick<ReservationCancellationEmailProps, "locale">) =>
  m.reservationCancellationEmailSubject({}, { locale });

/** Tells the customer which reservation was cancelled. */
export function ReservationCancellationEmail(
  props: ReservationCancellationEmailProps
) {
  const { locale, reservation } = props;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={reservationCancellationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.reservationCancellationEmailHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.reservationCancellationEmailBody({}, { locale })}
      </WorkspaceEmailBody>
      <WorkspaceEmailDetails
        details={reservationEmailDetails(reservation, locale)}
      />
    </WorkspaceEmailLayout>
  );
}

ReservationCancellationEmail.PreviewProps = reservationCancellationPreviewProps;

export default ReservationCancellationEmail;
