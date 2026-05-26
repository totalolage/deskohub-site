import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import { baseLocale, type Locale, m } from "@/features/i18n";
import {
  type EmailDetailRow,
  MultilineEmailText,
  renderEmailRowsText,
  renderWorkspaceEmailHtml,
  WorkspaceEmailRows,
} from "@/shared/backend/email/rendering";
import { StorageError } from "@/shared/backend/errors";
import { workspaceSiteConstants } from "@/shared/utils";

export interface ContactSubmission {
  name: string;
  email: string;
  phone?: string;
  message: string;
  submittedAt: string;
  locale?: Locale;
}

export interface ContactService {
  readonly submit: (
    data: Omit<ContactSubmission, "submittedAt">,
    locale?: Locale
  ) => Effect.Effect<ContactSubmission, StorageError>;
}

export const ContactService =
  Context.GenericTag<ContactService>("ContactService");

const workspaceRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
} as const;

const formatSubmissionDate = (submittedAt: string, locale?: Locale) =>
  new Date(submittedAt).toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  });

const getBusinessSubject = (name: string, locale: Locale) =>
  m.contactEmailBusinessSubject({ name }, { locale });

const getConfirmationSubject = (locale: Locale) =>
  m.contactEmailConfirmationSubject({}, { locale });

const messageBlockStyle = {
  background: "#f4f1ea",
  borderRadius: "16px",
  padding: "16px",
  whiteSpace: "normal",
} as const;

const createDetailRows = (
  submission: ContactSubmission,
  formattedDate: string,
  locale: Locale
): EmailDetailRow[] => {
  const rows: EmailDetailRow[] = [
    [m.contactEmailNameLabel({}, { locale }), submission.name],
    [m.contactEmailEmailLabel({}, { locale }), submission.email],
    [m.contactEmailSubmittedAtLabel({}, { locale }), formattedDate],
  ];

  if (submission.phone) {
    rows.splice(2, 0, [
      m.contactEmailPhoneLabel({}, { locale }),
      submission.phone,
    ]);
  }

  return rows;
};

export const ContactServiceLive = Layer.effect(
  ContactService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    return ContactService.of({
      submit: Effect.fn("workspaceContactSubmit")(
        function* (data, locale) {
          const emailLocale = locale ?? baseLocale;
          const submission: ContactSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale: emailLocale,
          };

          const formattedDate = formatSubmissionDate(
            submission.submittedAt,
            emailLocale
          );
          const rows = createDetailRows(submission, formattedDate, emailLocale);
          const businessHeading = m.contactEmailBusinessHeading(
            {},
            { locale: emailLocale }
          );
          const messageHeading = m.contactEmailMessageHeading(
            {},
            { locale: emailLocale }
          );
          const messageTextHeading = m.contactEmailMessageTextHeading(
            {},
            { locale: emailLocale }
          );
          const confirmationHeading = m.contactEmailCustomerHeading(
            {},
            { locale: emailLocale }
          );
          const confirmationBody = m.contactEmailCustomerBody(
            {},
            { locale: emailLocale }
          );
          const confirmationFollowUp = m.contactEmailCustomerFollowUp(
            { email: workspaceSiteConstants.contact.infoEmail },
            { locale: emailLocale }
          );

          const businessEmailMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: workspaceRecipient,
            subject: getBusinessSubject(data.name, emailLocale),
            html: renderWorkspaceEmailHtml(
              <div
                style={{
                  fontFamily: "Arial, sans-serif",
                  maxWidth: "600px",
                  margin: "0 auto",
                  color: "#0b1848",
                }}
              >
                <h2 style={{ color: "#0b1848" }}>{businessHeading}</h2>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    marginTop: "16px",
                  }}
                >
                  <tbody>
                    <WorkspaceEmailRows rows={rows} />
                  </tbody>
                </table>
                <h3 style={{ marginTop: "24px", color: "#0b1848" }}>
                  {messageHeading}
                </h3>
                <div style={messageBlockStyle}>
                  <MultilineEmailText value={data.message} />
                </div>
              </div>
            ),
            text: [
              businessHeading,
              "",
              ...renderEmailRowsText(rows),
              "",
              messageTextHeading,
              data.message,
            ].join("\n"),
            replyTo: {
              email: data.email,
              name: data.name,
            },
            tags: ["workspace-contact-form"],
            metadata: {
              source: "workspace-contact-form",
              customerName: data.name,
              customerEmail: data.email,
              submittedAt: submission.submittedAt,
            },
          };

          yield* emailService.send(businessEmailMessage).pipe(
            Effect.mapError(
              (error) =>
                new StorageError({
                  message: m.contactEmailSendError({}, { locale: emailLocale }),
                  operation: "workspace.contact.submit",
                  cause: error,
                })
            )
          );

          const confirmationMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: {
              email: data.email,
              name: data.name,
            },
            subject: getConfirmationSubject(emailLocale),
            html: renderWorkspaceEmailHtml(
              <div
                style={{
                  fontFamily: "Arial, sans-serif",
                  maxWidth: "600px",
                  margin: "0 auto",
                  color: "#0b1848",
                }}
              >
                <h2 style={{ color: "#0b1848" }}>{confirmationHeading}</h2>
                <p>{confirmationBody}</p>
                <div style={{ ...messageBlockStyle, marginTop: "16px" }}>
                  <MultilineEmailText value={data.message} />
                </div>
                <p style={{ marginTop: "20px" }}>{confirmationFollowUp}</p>
              </div>
            ),
            text: [
              confirmationHeading,
              "",
              confirmationBody,
              "",
              data.message,
              "",
              confirmationFollowUp,
            ].join("\n"),
            tags: ["workspace-contact-confirmation"],
          };

          yield* emailService
            .send(confirmationMessage)
            .pipe(Effect.catchAll(() => Effect.void));

          return submission;
        },
        (effect, data, locale) =>
          effect.pipe(
            Effect.annotateLogs({
              locale,
              ...data,
            })
          )
      ),
    });
  })
);
