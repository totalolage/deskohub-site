import {
  EmailConfigTag,
  type EmailSendError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import { type Locale, m } from "@/features/i18n";
import {
  internalWorkspaceEmailRecipientFor,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import { StorageError } from "@/shared/backend/errors";
import {
  renderContactBusinessEmail,
  renderContactConfirmationEmail,
} from "./contact-emails";

interface ContactSubmission {
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

const toContactStorageError = (locale: Locale) => (cause: EmailSendError) =>
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

            const businessEmail = yield* renderContactBusinessEmail(
              submission
            ).pipe(Effect.mapError(toContactStorageError(locale)));
            const businessEmailMessage: EmailMessage = {
              from: emailConfig.defaultFrom,
              to: internalWorkspaceEmailRecipientFor(data.email),
              subject: businessEmail.subject,
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
              Effect.mapError(toContactStorageError(locale))
            );
            yield* Effect.logInfo(
              "Workspace contact business email send succeeded"
            );

            yield* Effect.gen(function* () {
              const confirmationEmail =
                yield* renderContactConfirmationEmail(submission);
              const confirmationMessage: EmailMessage = {
                from: emailConfig.defaultFrom,
                to: {
                  email: data.email,
                  name: data.name,
                },
                replyTo: workspaceEmailRecipient,
                subject: confirmationEmail.subject,
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
