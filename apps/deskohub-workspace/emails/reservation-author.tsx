import {
  ReservationEmailActionPanel,
  type ReservationEmailLocation,
  ReservationEmailLocationPanel,
  type ReservationEmailTable,
} from "./_components/reservation-email-sections";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { reservationAuthorPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

/**
 * The confirmation for an account that booked a reservation for someone
 * else. It links to the reservation's status page, which the author's own
 * session authorizes, and carries no access capability: the access link and
 * invoice link go only to the reservation customer.
 */
export type ReservationAuthorEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly body: string;
  readonly status: {
    readonly button: string;
    readonly url: string;
  };
  readonly labels: {
    readonly location: string;
    readonly directions: string;
    readonly table: string;
    readonly tables: string;
  };
  readonly location: ReservationEmailLocation;
  readonly table?: ReservationEmailTable;
  readonly details: readonly WorkspaceEmailDetail[];
  readonly followUp: string;
};

export function ReservationAuthorEmail({
  locale,
  preview,
  heading,
  body,
  status,
  labels,
  location,
  table,
  details,
  followUp,
}: ReservationAuthorEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>{body}</WorkspaceEmailBody>

      <ReservationEmailActionPanel
        action={status}
        labels={labels}
        {...(table && { table })}
      />
      <ReservationEmailLocationPanel labels={labels} location={location} />

      <WorkspaceEmailDetails details={details} />
      <WorkspaceEmailNote>{followUp}</WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

ReservationAuthorEmail.PreviewProps = reservationAuthorPreviewProps;

export default ReservationAuthorEmail;
