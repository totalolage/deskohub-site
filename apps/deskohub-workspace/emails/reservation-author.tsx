import {
  type DotyposCustomer,
  getCustomerDisplayName,
} from "@deskohub/dotypos";
import { getReservationProductTitle } from "@/features/checkout/product-catalog.i18n";
import { type Locale, m } from "@/features/i18n";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  type ReservationEmailReservation,
  reservationEmailDetails,
} from "./_components/reservation-email-details";
import {
  ReservationEmailActionPanel,
  ReservationEmailLocationPanel,
} from "./_components/reservation-email-sections";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { reservationAuthorPreviewProps } from "./_fixtures/preview-props";

/**
 * The confirmation for an account that booked a reservation for someone
 * else. It links to the reservation's status page, which the author's own
 * session authorizes, and carries no access capability: the access link and
 * invoice link go only to the reservation customer.
 */
export type ReservationAuthorEmailProps = {
  readonly locale: Locale;
  readonly reservation: ReservationEmailReservation &
    Pick<WorkspaceReservationDetails, "placement"> & {
      readonly customer: Pick<
        DotyposCustomer,
        "firstName" | "lastName" | "companyName"
      >;
    };
  readonly statusUrl: string;
};

/** The customer as the author's confirmation names them. */
const customerName = ({ reservation, locale }: ReservationAuthorEmailProps) =>
  getCustomerDisplayName(reservation.customer) ??
  m.checkoutEmailAuthorCustomerFallback({}, { locale });

/** The subject, which the inbox also previews. */
export const reservationAuthorEmailSubject = (
  props: ReservationAuthorEmailProps
) =>
  m.checkoutEmailAuthorSubject(
    { customer: customerName(props) },
    { locale: props.locale }
  );

export function ReservationAuthorEmail(props: ReservationAuthorEmailProps) {
  const { locale, reservation, statusUrl } = props;
  const { table } = reservation.placement;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={reservationAuthorEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.checkoutEmailAuthorHeading(
          {
            customer: customerName(props),
            product: getReservationProductTitle(
              reservation.reservationDetails,
              locale
            ),
          },
          { locale }
        )}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.checkoutEmailAuthorBody({}, { locale })}
      </WorkspaceEmailBody>

      <ReservationEmailActionPanel
        action={{
          button: m.checkoutEmailAuthorStatusButton({}, { locale }),
          url: statusUrl,
        }}
        locale={locale}
        {...(table && { table })}
      />
      <ReservationEmailLocationPanel locale={locale} />

      <WorkspaceEmailDetails
        details={reservationEmailDetails(reservation, locale)}
      />
      <WorkspaceEmailNote>
        {m.reservationEmailCustomerFollowUp(
          { email: workspaceSiteConstants.contact.infoEmail },
          { locale }
        )}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

ReservationAuthorEmail.PreviewProps = reservationAuthorPreviewProps;

export default ReservationAuthorEmail;
