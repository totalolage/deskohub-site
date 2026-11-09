import { Effect } from "effect";
import {
  ContactBusinessEmail,
  type ContactBusinessEmailProps,
  contactBusinessEmailSubject,
} from "@/emails/contact-business";
import {
  ContactConfirmationEmail,
  type ContactConfirmationEmailProps,
  contactConfirmationEmailSubject,
} from "@/emails/contact-confirmation";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import { workspaceEmailEnvironment } from "@/shared/backend/email/workspace-email-recipients";

/** Renders the staff notification of a contact form submission. */
export const renderContactBusinessEmail = (
  submission: Omit<ContactBusinessEmailProps, "environment">
) => {
  const props: ContactBusinessEmailProps = {
    name: submission.name,
    email: submission.email,
    phone: submission.phone,
    message: submission.message,
    submittedAt: submission.submittedAt,
    environment: workspaceEmailEnvironment(),
  };

  return Effect.map(
    renderWorkspaceEmail(<ContactBusinessEmail {...props} />),
    (rendered) => ({ subject: contactBusinessEmailSubject(props), ...rendered })
  );
};

/** Renders the visitor's confirmation of a contact form submission. */
export const renderContactConfirmationEmail = (
  submission: ContactConfirmationEmailProps
) => {
  const props: ContactConfirmationEmailProps = {
    locale: submission.locale,
    message: submission.message,
  };

  return Effect.map(
    renderWorkspaceEmail(<ContactConfirmationEmail {...props} />),
    (rendered) => ({
      subject: contactConfirmationEmailSubject(props),
      ...rendered,
    })
  );
};
