import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import { ContactBusinessEmail } from "@/emails/contact-business";
import { ContactConfirmationEmail } from "@/emails/contact-confirmation";
import type { WorkspaceEmailDetail } from "@/emails/workspace-email-detail";
import { env } from "@/env";
import { type Locale, m } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
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

export interface IContactService {
  readonly submit: (
    data: Omit<ContactSubmission, "submittedAt" | "locale">,
    locale: Locale
  ) => Effect.Effect<ContactSubmission, StorageError>;
}

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
    timeZone: workspaceSiteConstants.location.timeZone,
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

const createContactEmailDetails = (
  submission: ContactSubmission,
  formattedDate: string,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.contactEmailNameLabel({}, { locale }),
    value: submission.name,
  },
  {
    label: m.contactEmailEmailLabel({}, { locale }),
    value: submission.email,
  },
  ...(submission.phone
    ? [
        {
          label: m.contactEmailPhoneLabel({}, { locale }),
          value: submission.phone,
        },
      ]
    : []),
  {
    label: m.contactEmailSubmittedAtLabel({}, { locale }),
    value: formattedDate,
  },
];

const toContactStorageError = (locale: Locale, cause: unknown) =>
  new StorageError({
    message: m.contactEmailSendError({}, { locale }),
    operation: "workspace.contact.submit",
    cause,
  });

export class ContactService extends Context.Service<
  ContactService,
  IContactService
>()("ContactService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      const emailConfig = yield* EmailConfigTag;

      return ContactService.of({
        submit: Effect.fn("ContactService.submit")(
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

            const businessSubject = getBusinessSubject(data.name);
            const businessHeading = m.contactEmailBusinessHeading(
              {},
              { locale: businessNotificationLocale }
            );
            const businessEmail = yield* renderWorkspaceEmail(
              <ContactBusinessEmail
                details={createContactEmailDetails(
                  submission,
                  formatSubmissionDate(
                    submission.submittedAt,
                    businessNotificationLocale
                  ),
                  businessNotificationLocale
                )}
                heading={businessHeading}
                locale={businessNotificationLocale}
                message={data.message}
                messageHeading={m.contactEmailMessageHeading(
                  {},
                  { locale: businessNotificationLocale }
                )}
                preview={businessSubject}
              />
            ).pipe(
              Effect.mapError((cause) => toContactStorageError(locale, cause))
            );
            const businessEmailMessage: EmailMessage = {
              from: emailConfig.defaultFrom,
              to: workspaceRecipient,
              subject: businessSubject,
              html: businessEmail.html,
              text: businessEmail.text,
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
              Effect.mapError((cause) => toContactStorageError(locale, cause))
            );
            yield* Effect.logInfo(
              "Workspace contact business email send succeeded"
            );

            const confirmationSubject = getConfirmationSubject(locale);
            yield* Effect.gen(function* () {
              const confirmationEmail = yield* renderWorkspaceEmail(
                <ContactConfirmationEmail
                  body={m.contactEmailCustomerBody({}, { locale })}
                  followUp={m.contactEmailCustomerFollowUp(
                    { email: workspaceSiteConstants.contact.infoEmail },
                    { locale }
                  )}
                  heading={m.contactEmailCustomerHeading({}, { locale })}
                  locale={locale}
                  message={data.message}
                  preview={confirmationSubject}
                />
              );
              const confirmationMessage: EmailMessage = {
                from: emailConfig.defaultFrom,
                to: {
                  email: data.email,
                  name: data.name,
                },
                replyTo: workspaceRecipient,
                subject: confirmationSubject,
                html: confirmationEmail.html,
                text: confirmationEmail.text,
                tags: ["workspace-contact-confirmation"],
              };
              yield* Effect.annotateLogsScoped({ confirmationMessage });
              yield* Effect.logInfo(
                "Workspace contact confirmation email send started"
              );
              yield* emailService.send(confirmationMessage);
              yield* Effect.logInfo(
                "Workspace contact confirmation email send succeeded"
              );
            }).pipe(
              Effect.catch((error) =>
                Effect.logWarning(
                  "Contact confirmation email delivery failed",
                  {
                    error,
                    errorType: error._tag,
                    errorMessage: error.message,
                    submission,
                  }
                )
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
}
