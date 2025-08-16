import { Context, Effect, Layer } from "effect";
import {
  type EmailConfig,
  getEmailConfig,
} from "@/shared/backend/config/email.config";
import { ExternalAPIError, NetworkError } from "@/shared/backend/errors";
import type { BookingData } from "../booking";
import type { DotyposReservation } from "./dotypos.service";

// Email templates
export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
}

// Service interface
export interface EmailService {
  readonly sendReservationConfirmation: (
    booking: BookingData,
    reservation: DotyposReservation
  ) => Effect.Effect<void, ExternalAPIError | NetworkError>;

  readonly sendReservationNotification: (
    booking: BookingData,
    reservation: DotyposReservation
  ) => Effect.Effect<void, ExternalAPIError | NetworkError>;

  readonly sendEmail: (
    message: EmailMessage
  ) => Effect.Effect<void, ExternalAPIError | NetworkError>;
}

export const EmailService = Context.GenericTag<EmailService>("EmailService");

// Email template generators
const generateCustomerConfirmationEmail = (
  booking: BookingData,
  reservation: DotyposReservation,
  locale: string = "en"
): EmailTemplate => {
  const dateTime = new Date(booking.datetime);
  const formattedDate = dateTime.toLocaleDateString(
    locale === "cs" ? "cs-CZ" : "en-US"
  );
  const formattedTime = dateTime.toLocaleTimeString(
    locale === "cs" ? "cs-CZ" : "en-US",
    {
      hour: "2-digit",
      minute: "2-digit",
    }
  );

  const subject =
    locale === "cs"
      ? `Potvrzení rezervace - Deskohub ${formattedDate}`
      : `Reservation Confirmation - Deskohub ${formattedDate}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #22c55e; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .details { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .detail-row { margin: 10px 0; }
        .label { font-weight: bold; color: #666; }
        .footer { text-align: center; padding: 20px; font-size: 14px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${locale === "cs" ? "Potvrzení rezervace" : "Reservation Confirmed"}</h1>
        </div>
        <div class="content">
          <p>${locale === "cs" ? "Dobrý den" : "Hello"} ${booking.name},</p>
          <p>${
            locale === "cs"
              ? "Vaše rezervace byla úspěšně potvrzena. Níže naleznete detaily:"
              : "Your reservation has been successfully confirmed. Here are the details:"
          }</p>
          
          <div class="details">
            <div class="detail-row">
              <span class="label">${locale === "cs" ? "Datum:" : "Date:"}</span> ${formattedDate}
            </div>
            <div class="detail-row">
              <span class="label">${locale === "cs" ? "Čas:" : "Time:"}</span> ${formattedTime}
            </div>
            <div class="detail-row">
              <span class="label">${locale === "cs" ? "Počet osob:" : "Number of guests:"}</span> ${booking.guestCount}
            </div>
            ${
              booking.tablePreference
                ? `
            <div class="detail-row">
              <span class="label">${locale === "cs" ? "Preference stolu:" : "Table preference:"}</span> ${booking.tablePreference}
            </div>
            `
                : ""
            }
            ${
              booking.specialRequests
                ? `
            <div class="detail-row">
              <span class="label">${locale === "cs" ? "Speciální požadavky:" : "Special requests:"}</span> ${booking.specialRequests}
            </div>
            `
                : ""
            }
            <div class="detail-row">
              <span class="label">${locale === "cs" ? "Kód rezervace:" : "Reservation code:"}</span> ${reservation.id}
            </div>
          </div>
          
          <p>${
            locale === "cs"
              ? "Těšíme se na Vaši návštěvu!"
              : "We look forward to seeing you!"
          }</p>
        </div>
        <div class="footer">
          <p>Deskohub - Coworking & Café</p>
          <p>${
            locale === "cs"
              ? "Pro zrušení nebo změnu rezervace nás prosím kontaktujte."
              : "Please contact us to cancel or modify your reservation."
          }</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const text =
    locale === "cs"
      ? `Potvrzení rezervace - Deskohub

Dobrý den ${booking.name},

Vaše rezervace byla úspěšně potvrzena.

Detaily rezervace:
- Datum: ${formattedDate}
- Čas: ${formattedTime}
- Počet osob: ${booking.guestCount}
${booking.tablePreference ? `- Preference stolu: ${booking.tablePreference}` : ""}
${booking.specialRequests ? `- Speciální požadavky: ${booking.specialRequests}` : ""}
- Kód rezervace: ${reservation.id}

Těšíme se na Vaši návštěvu!

Deskohub - Coworking & Café
Pro zrušení nebo změnu rezervace nás prosím kontaktujte.`
      : `Reservation Confirmation - Deskohub

Hello ${booking.name},

Your reservation has been successfully confirmed.

Reservation details:
- Date: ${formattedDate}
- Time: ${formattedTime}
- Number of guests: ${booking.guestCount}
${booking.tablePreference ? `- Table preference: ${booking.tablePreference}` : ""}
${booking.specialRequests ? `- Special requests: ${booking.specialRequests}` : ""}
- Reservation code: ${reservation.id}

We look forward to seeing you!

Deskohub - Coworking & Café
Please contact us to cancel or modify your reservation.`;

  return { subject, html, text };
};

const generateStaffNotificationEmail = (
  booking: BookingData,
  reservation: DotyposReservation
): EmailTemplate => {
  const dateTime = new Date(booking.datetime);
  const formattedDate = dateTime.toLocaleDateString("cs-CZ");
  const formattedTime = dateTime.toLocaleTimeString("cs-CZ", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const subject = `Nová rezervace - ${booking.name} - ${formattedDate} ${formattedTime}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${subject}</title>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background-color: #3b82f6; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background-color: #f9f9f9; }
        .details { background-color: white; padding: 20px; margin: 20px 0; border-radius: 8px; }
        .detail-row { margin: 10px 0; }
        .label { font-weight: bold; color: #666; width: 150px; display: inline-block; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Nová rezervace</h1>
        </div>
        <div class="content">
          <div class="details">
            <div class="detail-row">
              <span class="label">Jméno:</span> ${booking.name}
            </div>
            <div class="detail-row">
              <span class="label">Email:</span> ${booking.email}
            </div>
            <div class="detail-row">
              <span class="label">Telefon:</span> ${booking.phone || "Neuvedeno"}
            </div>
            <div class="detail-row">
              <span class="label">Datum:</span> ${formattedDate}
            </div>
            <div class="detail-row">
              <span class="label">Čas:</span> ${formattedTime}
            </div>
            <div class="detail-row">
              <span class="label">Počet osob:</span> ${booking.guestCount}
            </div>
            <div class="detail-row">
              <span class="label">Délka rezervace:</span> ${booking.duration} ${booking.duration === 1 ? "hodina" : "hodiny"}
            </div>
            ${
              booking.tablePreference
                ? `
            <div class="detail-row">
              <span class="label">Preference stolu:</span> ${booking.tablePreference}
            </div>
            `
                : ""
            }
            ${
              booking.specialRequests
                ? `
            <div class="detail-row">
              <span class="label">Speciální požadavky:</span> ${booking.specialRequests}
            </div>
            `
                : ""
            }
            <div class="detail-row">
              <span class="label">ID rezervace:</span> ${reservation.id}
            </div>
            <div class="detail-row">
              <span class="label">Status:</span> ${reservation.status}
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  const text = `Nová rezervace

Jméno: ${booking.name}
Email: ${booking.email}
Telefon: ${booking.phone || "Neuvedeno"}
Datum: ${formattedDate}
Čas: ${formattedTime}
Počet osob: ${booking.guestCount}
Délka rezervace: ${booking.duration} ${booking.duration === 1 ? "hodina" : "hodiny"}
${booking.tablePreference ? `Preference stolu: ${booking.tablePreference}` : ""}
${booking.specialRequests ? `Speciální požadavky: ${booking.specialRequests}` : ""}
ID rezervace: ${reservation.id}
Status: ${reservation.status}`;

  return { subject, html, text };
};

// Email sender implementations
const sendViaResend = (
  config: EmailConfig,
  message: EmailMessage
): Effect.Effect<void, ExternalAPIError | NetworkError> =>
  Effect.gen(function* () {
    if (!config.apiKey) {
      return yield* Effect.fail(
        new ExternalAPIError("Resend", "API key not configured", 500)
      );
    }

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: config.from,
            to: message.to,
            subject: message.subject,
            html: message.html,
            text: message.text,
            reply_to: message.replyTo || config.replyTo,
          }),
        }),
      catch: (error) =>
        new NetworkError(
          `Failed to connect to Resend API: ${error}`,
          "https://api.resend.com"
        ),
    });

    if (!response.ok) {
      const errorBody = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error("Unknown error"),
      }).pipe(Effect.catchAll(() => Effect.succeed("Unknown error")));

      return yield* Effect.fail(
        new ExternalAPIError(
          "Resend",
          `Failed to send email: ${errorBody}`,
          response.status
        )
      );
    }

    // Return void on success
    return;
  });

// Implementation
export const EmailServiceLive = Layer.effect(
  EmailService,
  Effect.gen(function* () {
    const config = yield* getEmailConfig;
    const notificationEmail = config.replyTo || "staff@deskohub.cz"; // Staff notification email

    return EmailService.of({
      sendReservationConfirmation: (booking, reservation) => {
        const template = generateCustomerConfirmationEmail(
          booking,
          reservation,
          "cs"
        );
        return sendViaResend(config, {
          to: booking.email,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });
      },

      sendReservationNotification: (booking, reservation) => {
        const template = generateStaffNotificationEmail(booking, reservation);
        return sendViaResend(config, {
          to: notificationEmail,
          subject: template.subject,
          html: template.html,
          text: template.text,
        });
      },

      sendEmail: (message) => sendViaResend(config, message),
    });
  })
);
