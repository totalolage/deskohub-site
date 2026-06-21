import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import { env } from "@/env";
import { type Locale, m } from "@/features/i18n";
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
  locale: Locale;
}

export interface ContactService {
  readonly submit: (
    data: Omit<ContactSubmission, "submittedAt" | "locale">,
    locale: Locale
  ) => Effect.Effect<ContactSubmission, StorageError>;
}

export const ContactService = Context.Service<ContactService>("ContactService");

const workspaceRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
} as const;

const businessNotificationLocale: Locale = "cs-CZ";
const businessTestingSubjectPrefix = "[TESTING]";

const formatSubmissionDate = (submittedAt: string, locale: Locale) =>
  new Date(submittedAt).toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  });

const getBusinessSubject = (name: string) => {
  const subject = m.contactEmailBusinessSubject(
    { name },
    { locale: businessNotificationLocale }
  );

  if (env.VERCEL_ENV === "production") {
    return subject;
  }

  return `${businessTestingSubjectPrefix} ${subject}`;
};

const getConfirmationSubject = (locale: Locale) =>
  m.contactEmailConfirmationSubject({}, { locale });

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
          yield* Effect.annotateLogsScoped({ data, locale });
          yield* Effect.logInfo("Workspace contact submission started");

          const submission: ContactSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale,
          };
          yield* Effect.annotateLogsScoped({ submission });
          yield* Effect.logInfo("Workspace contact submission prepared");

          const businessFormattedDate = formatSubmissionDate(
            submission.submittedAt,
            businessNotificationLocale
          );
          const businessRows = createDetailRows(
            submission,
            businessFormattedDate,
            businessNotificationLocale
          );
          const businessHeading = m.contactEmailBusinessHeading(
            {},
            { locale: businessNotificationLocale }
          );
          const messageHeading = m.contactEmailMessageHeading(
            {},
            { locale: businessNotificationLocale }
          );
          const messageTextHeading = m.contactEmailMessageTextHeading(
            {},
            { locale: businessNotificationLocale }
          );
          const confirmationHeading = m.contactEmailCustomerHeading(
            {},
            { locale }
          );
          const confirmationBody = m.contactEmailCustomerBody({}, { locale });
          const confirmationFollowUp = m.contactEmailCustomerFollowUp(
            { email: workspaceSiteConstants.contact.infoEmail },
            { locale }
          );

          const businessEmailMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: workspaceRecipient,
            subject: getBusinessSubject(data.name),
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
                    <WorkspaceEmailRows rows={businessRows} />
                  </tbody>
                </table>
                <h3 style={{ marginTop: "24px", color: "#0b1848" }}>
                  {messageHeading}
                </h3>
                <div
                  style={{
                    background: "#f4f1ea",
                    borderRadius: "16px",
                    padding: "16px",
                    whiteSpace: "normal",
                  }}
                >
                  <MultilineEmailText value={data.message} />
                </div>
              </div>
            ),
            text: [
              businessHeading,
              "",
              ...renderEmailRowsText(businessRows),
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
          yield* Effect.annotateLogsScoped({ businessEmailMessage });
          yield* Effect.logInfo(
            "Workspace contact business email send started"
          );

          yield* emailService.send(businessEmailMessage).pipe(
            Effect.tapError((cause) =>
              Effect.logError(
                "Workspace contact business email delivery failed",
                {
                  cause,
                  businessEmailMessage,
                  submission,
                }
              )
            ),
            Effect.mapError(
              (error) =>
                new StorageError({
                  message: m.contactEmailSendError({}, { locale }),
                  operation: "workspace.contact.submit",
                  cause: error,
                })
            )
          );
          yield* Effect.logInfo(
            "Workspace contact business email send succeeded"
          );

          const confirmationMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: {
              email: data.email,
              name: data.name,
            },
            replyTo: workspaceRecipient,
            subject: getConfirmationSubject(locale),
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
                <div
                  style={{
                    background: "#f4f1ea",
                    borderRadius: "16px",
                    marginTop: "16px",
                    padding: "16px",
                    whiteSpace: "normal",
                  }}
                >
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
          yield* Effect.annotateLogsScoped({ confirmationMessage });
          yield* Effect.logInfo(
            "Workspace contact confirmation email send started"
          );

          yield* emailService.send(confirmationMessage).pipe(
            Effect.tap(() =>
              Effect.logInfo(
                "Workspace contact confirmation email send succeeded"
              )
            ),
            Effect.catch((error) =>
              Effect.logWarning("Contact confirmation email delivery failed", {
                error,
                errorType: error._tag,
                errorMessage: error.message,
                confirmationMessage,
                submission,
              })
            )
          );

          return submission;
        },
        (effect, data, locale) =>
          effect.pipe(
            Effect.scoped,
            Effect.annotateLogs({
              locale,
              hasPhone: Boolean(data.phone),
              hasMessage: data.message.length > 0,
            })
          )
      ),
    });
  })
);
