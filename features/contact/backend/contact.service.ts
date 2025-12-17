import { Context, Effect, Layer } from "effect";
import { EmailServiceTag } from "@/features/email/backend/service";
import type { EmailMessage } from "@/features/email/types/email.types";
import { StorageError } from "@/shared/backend/errors";
import { siteConstants } from "@/shared/utils/constants";

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

export const ContactService =
  Context.GenericTag<ContactService>("ContactService");

export const ContactServiceLive = Layer.effect(
  ContactService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    return ContactService.of({
      submit: (data, locale) =>
        Effect.gen(function* () {
          const submission: ContactSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale,
          };

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
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Nová zpráva z kontaktního formuláře</h2>
                
                <h3 style="color: #666;">Kontaktní údaje:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Jméno:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.name}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.email}</td>
                  </tr>
                  ${
                    data.phone
                      ? `
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Telefon:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.phone}</td>
                  </tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Datum a čas:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedDate}</td>
                  </tr>
                </table>
                
                <h3 style="color: #666; margin-top: 20px;">Zpráva:</h3>
                <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; white-space: pre-wrap;">
${data.message}
                </div>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="color: #999; font-size: 12px;">
                  Tato zpráva byla automaticky vygenerována z kontaktního formuláře na webu DeskoHub.
                </p>
              </div>
            `,
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
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">${locale === "cs-CZ" ? "Potvrzení přijetí zprávy" : "Message Received"}</h2>
                <p>${
                  locale === "cs-CZ"
                    ? "Děkujeme za vaši zprávu. Přijali jsme ji a brzy vás budeme kontaktovat."
                    : "Thank you for your message. We have received it and will contact you soon."
                }</p>
                
                <h3 style="color: #666;">${locale === "cs-CZ" ? "Shrnutí vaší zprávy:" : "Your Message Summary:"}</h3>
                <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; white-space: pre-wrap;">
${data.message}
                </div>
                
                <p style="margin-top: 20px;">
                  ${
                    locale === "cs-CZ"
                      ? `Pokud máte jakékoliv další dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.contactEmail}.`
                      : `If you have any other questions, please don't hesitate to contact us at ${siteConstants.contact.contactEmail}.`
                  }
                </p>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="color: #999; font-size: 12px;">
                  DeskoHub<br>
                  ${locale === "cs-CZ" ? "Váš prostor pro práci a kreativitu" : "Your space for work and creativity"}
                </p>
              </div>
            `,
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
                  customerEmail: data.email,
                }
              )
            ),
            Effect.catchAll(() => Effect.void)
          );

          return submission;
        }).pipe(
          Effect.withSpan("submitContactForm", {
            attributes: {
              "contact.name": data.name,
              "contact.email": data.email,
              "contact.hasPhone": !!data.phone,
            },
          })
        ),
    });
  })
);
