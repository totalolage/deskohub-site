import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { BoardgameEmailLayer } from "@/shared/backend/config/email.config";
import { StorageError } from "@/shared/backend/errors";
import { siteConstants } from "@/shared/utils/constants";
import {
  renderBusinessContactEmailHtml,
  renderContactConfirmationEmailHtml,
} from "./contact-email-rendering";

// Business email copy is Czech regardless of the customer locale.
const businessEmailLocale: Locale = "cs-CZ";

export interface ContactSubmission {
  name: string;
  email: string;
  phone?: string;
  message: string;
  submittedAt: string;
  locale: Locale;
}

interface IContactService {
  readonly submit: (
    data: Omit<ContactSubmission, "submittedAt" | "locale">,
    locale: Locale
  ) => Effect.Effect<ContactSubmission, StorageError>;
}

export class ContactService extends Context.Service<
  ContactService,
  IContactService
>()("ContactService") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => contactServiceImplementation)
  );

  static Live = this.Default.pipe(Layer.provide(BoardgameEmailLayer));
}

const contactServiceImplementation = Effect.gen(function* () {
  const emailService = yield* EmailServiceTag;

  return ContactService.of({
    submit: Effect.fn("contact.submit")(
      function* (data, locale) {
        yield* Effect.annotateLogsScoped({ data, locale });
        yield* Effect.logInfo("Contact form submission service started");

        const submission: ContactSubmission = {
          ...data,
          submittedAt: new Date().toISOString(),
          locale,
        };
        yield* Effect.annotateLogsScoped({ submission });

        yield* Effect.logInfo("Processing contact form submission", {
          email: data.email,
          name: data.name,
          locale,
        });

        // Format the contact form data for display
        const formattedDate = new Date(submission.submittedAt).toLocaleString(
          locale,
          {
            dateStyle: "full",
            timeStyle: "short",
            timeZone: siteConstants.workingHours.timezone,
          }
        );

        // Create email content for the business
        const businessEmailContent = {
          subject: m["contact.email.businessSubject"](
            { name: data.name },
            { locale: businessEmailLocale }
          ),
          html: renderBusinessContactEmailHtml({
            name: data.name,
            email: data.email,
            phone: data.phone,
            formattedDate,
            message: data.message,
          }),
          text: `${m["contact.email.businessText"](
            {
              name: data.name,
              email: data.email,
              phoneLine: data.phone
                ? m["contact.email.businessPhoneLine"](
                    { phone: data.phone },
                    { locale: businessEmailLocale }
                  )
                : "",
              dateTime: formattedDate,
              message: data.message,
            },
            { locale: businessEmailLocale }
          )}\n\n---\n${m["contact.email.footer"](undefined, {
            locale: businessEmailLocale,
          })}`,
        };

        // Create the email message for business
        const businessEmailMessage: EmailMessage = {
          from: {
            email: siteConstants.contact.fromEmail,
            name: m["contact.email.fromName"](undefined, {
              locale: businessEmailLocale,
            }),
          },
          to: {
            email: siteConstants.contact.contactEmail,
            name: "DeskoHub Kontakt",
          },
          subject: businessEmailContent.subject,
          html: businessEmailContent.html,
          text: businessEmailContent.text,
          replyTo: {
            email: data.email,
            name: data.name,
          },
          tags: ["contact-form"],
          metadata: {
            source: "contact-form",
            customerName: data.name,
            customerEmail: data.email,
            submittedAt: submission.submittedAt,
          },
        };
        yield* Effect.annotateLogsScoped({ businessEmailMessage });
        yield* Effect.logInfo("Contact form business email prepared");

        // Send the email to business - this must succeed
        yield* emailService.send(businessEmailMessage).pipe(
          Effect.tap(() =>
            Effect.logInfo("Contact form email sent to business", {
              to: siteConstants.contact.contactEmail,
              customerEmail: data.email,
            })
          ),
          Effect.tapError((error) =>
            Effect.logError("Failed to send contact form email to business", {
              error,
              businessEmailMessage,
              customerEmail: data.email,
            })
          ),
          Effect.mapError(
            (error) =>
              new StorageError({
                message: m["contact.submitFailed"](undefined, {
                  locale,
                }),
                operation: "contact.submit",
                cause: error,
              })
          )
        );

        // Create confirmation email for customer
        const confirmationMessage: EmailMessage = {
          from: {
            email: siteConstants.contact.fromEmail,
            name: siteConstants.brand.name,
          },
          to: {
            email: data.email,
            name: data.name,
          },
          subject: m["contact.email.confirmationSubject"](undefined, {
            locale: locale,
          }),
          html: renderContactConfirmationEmailHtml({
            locale,
            message: data.message,
          }),
          text: m["contact.email.confirmationText"](
            {
              message: data.message,
              contactLine: m["contact.email.confirmationContactLine"](
                { contactEmail: siteConstants.contact.contactEmail },
                { locale }
              ),
            },
            { locale }
          ),
          tags: ["contact-confirmation"],
        };
        yield* Effect.annotateLogsScoped({ confirmationMessage });
        yield* Effect.logInfo("Contact form confirmation email prepared");

        // Send confirmation email to customer (don't fail if this fails)
        yield* emailService.send(confirmationMessage).pipe(
          Effect.tap(() =>
            Effect.logInfo("Confirmation email sent to customer", {
              customerEmail: data.email,
            })
          ),
          Effect.tapError((error) =>
            Effect.logWarning("Failed to send confirmation email to customer", {
              error,
              confirmationMessage,
              customerEmail: data.email,
            })
          ),
          Effect.catch(() => Effect.void)
        );

        yield* Effect.logDebug("Contact form submission service completed");

        return submission;
      },
      (effect, data) =>
        effect.pipe(
          Effect.scoped,
          Effect.withSpan("submitContactForm", {
            attributes: {
              "contact.name": data.name,
              "contact.email": data.email,
              "contact.hasPhone": !!data.phone,
            },
          })
        )
    ),
  });
});
