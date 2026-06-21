import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import { StorageError } from "@/shared/backend/errors";
import { siteConstants } from "@/shared/utils/constants";
import {
  renderBusinessContactEmailHtml,
  renderContactConfirmationEmailHtml,
} from "./contact-email-rendering";

export interface ContactSubmission {
  name: string;
  email: string;
  phone?: string;
  message: string;
  submittedAt: string;
  locale?: string;
}

export interface ContactService {
  readonly submit: (
    data: Omit<ContactSubmission, "submittedAt">,
    locale?: string
  ) => Effect.Effect<ContactSubmission, StorageError>;
}

export const ContactService = Context.Service<ContactService>("ContactService");

export const ContactServiceLive = Layer.effect(
  ContactService,
  Effect.gen(function* () {
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
            subject: `Nová zpráva z kontaktního formuláře - ${data.name}`,
            html: renderBusinessContactEmailHtml({
              name: data.name,
              email: data.email,
              phone: data.phone,
              formattedDate,
              message: data.message,
            }),
            text: `
Nová zpráva z kontaktního formuláře

Kontaktní údaje:
- Jméno: ${data.name}
- Email: ${data.email}${data.phone ? `\n- Telefon: ${data.phone}` : ""}
- Datum a čas: ${formattedDate}

Zpráva:
${data.message}

---
Tato zpráva byla automaticky vygenerována z kontaktního formuláře na webu DeskoHub.
            `.trim(),
          };

          // Create the email message for business
          const businessEmailMessage: EmailMessage = {
            from: {
              email: siteConstants.contact.fromEmail,
              name: "Web Kontaktní Formulář",
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
                  message:
                    locale === "cs-CZ"
                      ? "Nepodařilo se odeslat zprávu. Zkuste to prosím později."
                      : "Failed to send message. Please try again later.",
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
            subject:
              locale === "cs-CZ"
                ? "Potvrzení přijetí vaší zprávy - DeskoHub"
                : "Message Received Confirmation - DeskoHub",
            html: renderContactConfirmationEmailHtml({
              locale,
              message: data.message,
            }),
            // biome-ignore format: Preserve plaintext email indentation.
            text:
              locale === "cs-CZ"
                ? `
Potvrzení přijetí zprávy

Děkujeme za vaši zprávu. Přijali jsme ji a brzy vás budeme kontaktovat.

Shrnutí vaší zprávy:
${data.message}

Pokud máte jakékoliv další dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.contactEmail}.

---
DeskoHub
Váš prostor pro práci a kreativitu
                `.trim()
                : `
Message Received

Thank you for your message. We have received it and will contact you soon.

Your Message Summary:
${data.message}

If you have any other questions, please don't hesitate to contact us at ${siteConstants.contact.contactEmail}.

---
DeskoHub
Your space for work and creativity
                `.trim(),
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
              Effect.logWarning(
                "Failed to send confirmation email to customer",
                {
                  error,
                  confirmationMessage,
                  customerEmail: data.email,
                }
              )
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
  })
);
