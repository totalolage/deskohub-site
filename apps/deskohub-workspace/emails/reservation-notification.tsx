import { Heading, Text } from "react-email";
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
      <Heading className="m-0 text-[30px] font-bold leading-[38px] text-navy">
        {heading}
      </Heading>
      <Text className="m-0 mt-4 text-[16px] leading-[25px] text-[#373a59]">
        {body}
      </Text>
      <WorkspaceEmailDetails details={details} />
    </WorkspaceEmailLayout>
  );
}

ReservationNotificationEmail.PreviewProps = reservationNotificationPreviewProps;

export default ReservationNotificationEmail;
