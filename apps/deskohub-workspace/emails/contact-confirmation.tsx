import { type Locale, m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import { MultilineEmailText } from "./_components/multiline-email-text";
import {
  WorkspaceEmailBody,
  WorkspaceEmailHeading,
  WorkspaceEmailNote,
  WorkspaceEmailPanel,
} from "./_components/workspace-email-content";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { contactConfirmationPreviewProps } from "./_fixtures/preview-props";

export type ContactConfirmationEmailProps = {
  readonly locale: Locale;
  readonly message: string;
};

/** The subject, which the inbox also previews. */
export const contactConfirmationEmailSubject = ({
  locale,
}: Pick<ContactConfirmationEmailProps, "locale">) =>
  m.contactEmailConfirmationSubject({}, { locale });

/** Confirms a contact form submission to the visitor, quoting the message. */
export function ContactConfirmationEmail(props: ContactConfirmationEmailProps) {
  const { locale, message } = props;

  return (
    <WorkspaceEmailLayout
      locale={locale}
      preview={contactConfirmationEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.contactEmailCustomerHeading({}, { locale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailBody>
        {m.contactEmailCustomerBody({}, { locale })}
      </WorkspaceEmailBody>
      <WorkspaceEmailPanel>
        <MultilineEmailText value={message} />
      </WorkspaceEmailPanel>
      <WorkspaceEmailNote>
        {m.contactEmailCustomerFollowUp(
          { email: workspaceSiteConstants.contact.infoEmail },
          { locale }
        )}
      </WorkspaceEmailNote>
    </WorkspaceEmailLayout>
  );
}

ContactConfirmationEmail.PreviewProps = contactConfirmationPreviewProps;

export default ContactConfirmationEmail;
