import { Heading } from "react-email";
import { MultilineEmailText } from "./_components/multiline-email-text";
import {
  WorkspaceEmailHeading,
  WorkspaceEmailPanel,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { contactBusinessPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ContactBusinessEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly messageHeading: string;
  readonly details: readonly WorkspaceEmailDetail[];
  readonly message: string;
};

export function ContactBusinessEmail({
  locale,
  preview,
  heading,
  messageHeading,
  details,
  message,
}: ContactBusinessEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailDetails details={details} />
      <Heading
        as="h2"
        className="m-0 mt-7 text-[18px] font-bold leading-[26px] text-navy"
      >
        {messageHeading}
      </Heading>
      <WorkspaceEmailPanel>
        <MultilineEmailText value={message} />
      </WorkspaceEmailPanel>
    </WorkspaceEmailLayout>
  );
}

ContactBusinessEmail.PreviewProps = contactBusinessPreviewProps;

export default ContactBusinessEmail;
