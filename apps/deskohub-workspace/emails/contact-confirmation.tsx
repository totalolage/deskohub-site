import { MultilineEmailText } from "./_components/multiline-email-text";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
  WorkspaceEmailPanel,
} from "./_components/workspace-email-content";
import {
  WorkspaceEmailLayout,
  type WorkspaceEmailLocale,
} from "./_components/workspace-email-layout";
import { contactConfirmationPreviewProps } from "./_fixtures/preview-props";

export type ContactConfirmationEmailProps = {
  readonly locale: WorkspaceEmailLocale;
  readonly preview: string;
  readonly heading: string;
  readonly body: string;
  readonly message: string;
  readonly followUp: string;
};

export function ContactConfirmationEmail({
  locale,
  preview,
  heading,
  body,
  message,
  followUp,
}: ContactConfirmationEmailProps) {
  return (
    <WorkspaceEmailLayout locale={locale} preview={preview}>
      <WorkspaceEmailHeading>{heading}</WorkspaceEmailHeading>
      <WorkspaceEmailBody>{body}</WorkspaceEmailBody>
      <WorkspaceEmailPanel>
        <MultilineEmailText value={message} />
      </WorkspaceEmailPanel>
      <WorkspaceEmailNote>{followUp}</WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

ContactConfirmationEmail.PreviewProps = contactConfirmationPreviewProps;

export default ContactConfirmationEmail;
