import { staffEmailSubject } from "@deskohub/email/backend/email-routing";
import { Heading } from "react-email";
import { m } from "@/features/i18n";
import { staffEmailLocale } from "@/shared/backend/email/staff-email-locale";
import { workspaceSiteConstants } from "@/shared/utils";
import { MultilineEmailText } from "./_components/multiline-email-text";
import {
  WorkspaceEmailHeading,
  WorkspaceEmailPanel,
} from "./_components/workspace-email-content";
import { WorkspaceEmailDetails } from "./_components/workspace-email-details";
import { WorkspaceEmailLayout } from "./_components/workspace-email-layout";
import { contactBusinessPreviewProps } from "./_fixtures/preview-props";
import type { WorkspaceEmailDetail } from "./workspace-email-detail";

export type ContactBusinessEmailProps = {
  readonly name: string;
  readonly email: string;
  readonly phone?: string;
  readonly message: string;
  /** ISO instant of the submission. */
  readonly submittedAt: string;
  /** Outside production the subject carries the test tag. */
  readonly environment: { readonly isProduction: boolean };
};

/** The delivered subject, test tag included, which staff inboxes preview. */
export const contactBusinessEmailSubject = ({
  name,
  environment,
}: Pick<ContactBusinessEmailProps, "name" | "environment">) =>
  staffEmailSubject(
    m.contactEmailBusinessSubject({ name }, { locale: staffEmailLocale }),
    environment
  );

/** Staff notification of a contact form submission, in the staff locale. */
export function ContactBusinessEmail(props: ContactBusinessEmailProps) {
  const { name, email, phone, message, submittedAt } = props;
  const details: WorkspaceEmailDetail[] = [
    {
      label: m.contactEmailNameLabel({}, { locale: staffEmailLocale }),
      value: name,
    },
    {
      label: m.contactEmailEmailLabel({}, { locale: staffEmailLocale }),
      value: email,
    },
    ...(phone
      ? [
          {
            label: m.contactEmailPhoneLabel({}, { locale: staffEmailLocale }),
            value: phone,
          },
        ]
      : []),
    {
      label: m.contactEmailSubmittedAtLabel({}, { locale: staffEmailLocale }),
      value: new Date(submittedAt).toLocaleString(staffEmailLocale, {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: workspaceSiteConstants.location.timeZone,
      }),
    },
  ];

  return (
    <WorkspaceEmailLayout
      locale={staffEmailLocale}
      preview={contactBusinessEmailSubject(props)}
    >
      <WorkspaceEmailHeading>
        {m.contactEmailBusinessHeading({}, { locale: staffEmailLocale })}
      </WorkspaceEmailHeading>
      <WorkspaceEmailDetails details={details} />
      <Heading
        as="h2"
        className="m-0 mt-7 text-[18px] font-bold leading-[26px] text-navy"
      >
        {m.contactEmailMessageHeading({}, { locale: staffEmailLocale })}
      </Heading>
      <WorkspaceEmailPanel>
        <MultilineEmailText value={message} />
      </WorkspaceEmailPanel>
    </WorkspaceEmailLayout>
  );
}

ContactBusinessEmail.PreviewProps = contactBusinessPreviewProps;

export default ContactBusinessEmail;
