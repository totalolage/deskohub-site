import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { reservationNotificationPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ReservationNotificationEmailProps = {
  readonly preview: string;
  readonly heading: string;
  readonly body: string;
  readonly details: readonly WorkspaceEmailDetail[];
};

export function ReservationNotificationEmail({
  preview,
  heading,
  body,
  details,
}: ReservationNotificationEmailProps) {
  return (
    <WorkspaceEmailLayout locale="cs-CZ" preview={preview}>
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>{body}</WorkspaceEmailBody>
      <WorkspaceEmailDetails details={details} />
    </WorkspaceEmailLayout>
  );
}

ReservationNotificationEmail.PreviewProps = reservationNotificationPreviewProps;

export default ReservationNotificationEmail;
