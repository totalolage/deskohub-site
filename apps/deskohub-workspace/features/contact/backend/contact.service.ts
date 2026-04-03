import {
  EmailConfigTag,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Context, Effect, Layer } from "effect";
import { StorageError } from "@/shared/backend/errors";
import { workspaceSiteConstants } from "@/shared/utils";

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

const workspaceRecipient = {
  email: workspaceSiteConstants.contact.infoEmail,
  name: workspaceSiteConstants.brand.name,
} as const;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatMessageHtml = (message: string) =>
  escapeHtml(message).replaceAll("\n", "<br />");

const formatSubmissionDate = (submittedAt: string, locale?: string) =>
  new Date(submittedAt).toLocaleString(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Prague",
  });

const getBusinessSubject = (name: string, locale?: string) =>
  locale === "cs-CZ"
    ? `Nová zpráva z kontaktního formuláře Workspace - ${name}`
    : `New Workspace contact form message - ${name}`;

const getConfirmationSubject = (locale?: string) =>
  locale === "cs-CZ"
    ? "Potvrzení přijetí zprávy - Deskohub Workspace"
    : "Message received - Deskohub Workspace";

export const ContactServiceLive = Layer.effect(
  ContactService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const emailConfig = yield* EmailConfigTag;

    return ContactService.of({
      submit: (data, locale) =>
        Effect.gen(function* () {
          const submission: ContactSubmission = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale,
          };

          const formattedDate = formatSubmissionDate(
            submission.submittedAt,
            locale
          );
          const safeName = escapeHtml(data.name);
          const safeEmail = escapeHtml(data.email);
          const safePhone = data.phone ? escapeHtml(data.phone) : undefined;
          const safeFormattedDate = escapeHtml(formattedDate);
          const safeMessageHtml = formatMessageHtml(data.message);

          const businessEmailMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: workspaceRecipient,
            subject: getBusinessSubject(data.name, locale),
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0b1848;">
                <h2 style="color: #0b1848;">${
                  locale === "cs-CZ"
                    ? "Nová zpráva z kontaktního formuláře Workspace"
                    : "New Workspace contact form message"
                }</h2>
                <table style="width: 100%; border-collapse: collapse; margin-top: 16px;">
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;"><strong>${
                      locale === "cs-CZ" ? "Jméno" : "Name"
                    }:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;">${safeName}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;"><strong>Email:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;">${safeEmail}</td>
                  </tr>
                  ${
                    safePhone
                      ? `<tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;"><strong>${
                      locale === "cs-CZ" ? "Telefon" : "Phone"
                    }:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;">${safePhone}</td>
                  </tr>`
                      : ""
                  }
                  <tr>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;"><strong>${
                      locale === "cs-CZ" ? "Datum a čas" : "Date and time"
                    }:</strong></td>
                    <td style="padding: 8px 0; border-bottom: 1px solid #e6e9f3;">${safeFormattedDate}</td>
                  </tr>
                </table>
                <h3 style="margin-top: 24px; color: #0b1848;">${
                  locale === "cs-CZ" ? "Zpráva" : "Message"
                }</h3>
                <div style="background: #f4f1ea; border-radius: 16px; padding: 16px; white-space: normal;">${safeMessageHtml}</div>
              </div>
            `,
            text: [
              locale === "cs-CZ"
                ? "Nová zpráva z kontaktního formuláře Workspace"
                : "New Workspace contact form message",
              "",
              `${locale === "cs-CZ" ? "Jméno" : "Name"}: ${data.name}`,
              `Email: ${data.email}`,
              ...(data.phone
                ? [`${locale === "cs-CZ" ? "Telefon" : "Phone"}: ${data.phone}`]
                : []),
              `${locale === "cs-CZ" ? "Datum a čas" : "Date and time"}: ${formattedDate}`,
              "",
              `${locale === "cs-CZ" ? "Zpráva" : "Message"}:`,
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
                  message:
                    locale === "cs-CZ"
                      ? "Nepodařilo se odeslat zprávu. Zkuste to prosím znovu později."
                      : "Failed to send your message. Please try again later.",
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
            subject: getConfirmationSubject(locale),
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #0b1848;">
                <h2 style="color: #0b1848;">${
                  locale === "cs-CZ" ? "Zpráva dorazila" : "Your message is in"
                }</h2>
                <p>
                  ${
                    locale === "cs-CZ"
                      ? "Děkujeme za zprávu. Ozveme se co nejdříve s dalším krokem nebo odpovědí."
                      : "Thanks for reaching out. We will get back to you as soon as possible with next steps or an answer."
                  }
                </p>
                <div style="background: #f4f1ea; border-radius: 16px; padding: 16px; white-space: normal; margin-top: 16px;">${safeMessageHtml}</div>
                <p style="margin-top: 20px;">
                  ${
                    locale === "cs-CZ"
                      ? `Pokud chceš cokoliv doplnit, napiš nám na ${workspaceSiteConstants.contact.infoEmail}.`
                      : `If you want to add anything, reply or write to ${workspaceSiteConstants.contact.infoEmail}.`
                  }
                </p>
              </div>
            `,
            text: [
              locale === "cs-CZ" ? "Zpráva dorazila" : "Your message is in",
              "",
              locale === "cs-CZ"
                ? "Děkujeme za zprávu. Ozveme se co nejdříve s dalším krokem nebo odpovědí."
                : "Thanks for reaching out. We will get back to you as soon as possible with next steps or an answer.",
              "",
              data.message,
              "",
              locale === "cs-CZ"
                ? `Pokud chceš cokoliv doplnit, napiš nám na ${workspaceSiteConstants.contact.infoEmail}.`
                : `If you want to add anything, reply or write to ${workspaceSiteConstants.contact.infoEmail}.`,
            ].join("\n"),
            tags: ["workspace-contact-confirmation"],
          };

          yield* emailService
            .send(confirmationMessage)
            .pipe(Effect.catchAll(() => Effect.void));

          return submission;
        }).pipe(
          Effect.withSpan("workspaceContactSubmit", {
            attributes: {
              "contact.name": data.name,
              "contact.email": data.email,
              "contact.hasPhone": Boolean(data.phone),
            },
          })
        ),
    });
  })
);
