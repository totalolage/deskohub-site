import { m } from "@/features/i18n";
import { staffLocale } from "@/shared/backend/staff-locale";
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
import { reservationNotificationPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ReservationNotificationEmailProps = {
  readonly reservation: ReservationEmailReservation;
  /** The customer as staff contact them. */
  readonly customer: {
    readonly name: string;
    readonly email?: string;
    readonly phone?: string | null;
  };
};

/**
 * The subject without the test tag, which the inbox previews; the delivered
 * subject carries the tag outside production.
 */
export const reservationNotificationEmailSubject = ({
  reservation,
}: Pick<ReservationNotificationEmailProps, "reservation">) =>
  m.checkoutEmailInternalPaidReservationSubject(
    { orderId: reservation.id },
    { locale: staffLocale }
  );

/** Staff notification of a paid reservation, in the staff locale. */
export function ReservationNotificationEmail(
  props: ReservationNotificationEmailProps
) {
  const { reservation, customer } = props;
  const details: WorkspaceEmailDetail[] = [
    {
      label: m.reservationEmailNameLabel({}, { locale: staffLocale }),
      value: customer.name,
    },
    ...(customer.email
      ? [
          {
            label: m.reservationEmailEmailLabel({}, { locale: staffLocale }),
            value: customer.email,
          },
        ]
      : []),
    ...(customer.phone?.trim()
      ? [
          {
            label: m.reservationEmailPhoneLabel({}, { locale: staffLocale }),
            value: customer.phone,
          },
        ]
      : []),
    ...reservationEmailDetails(reservation, staffLocale),
  ];

  return (
    <WorkspaceEmailLayout
      locale={staffLocale}
      preview={reservationNotificationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.checkoutEmailInternalPaidReservationHeading(
          {},
          { locale: staffLocale }
        )}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.checkoutEmailInternalPaidReservationBody(
          {},
          { locale: staffLocale }
        )}
      </WorkspaceEmailBody>
      <WorkspaceEmailDetails details={details} />
    </WorkspaceEmailLayout>
  );
}

ReservationNotificationEmail.PreviewProps = reservationNotificationPreviewProps;

export default ReservationNotificationEmail;
