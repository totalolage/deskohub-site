/**
 * Send Reservation Notification to Business
 *
 * Functions to send notification emails to the business about new reservations
 */

import type {
  Customer,
  Reservation,
} from "@deskohub/dotypos/generated/types.gen";
import { parseNoteData } from "@deskohub/dotypos/note-metadata";
import { Effect } from "effect";
import type { Locale } from "@/features/i18n";
import { DotyposConfig } from "@/shared/backend/config/dotypos.config";
import { siteConstants } from "@/shared/utils/constants";
import type { EmailMessage } from "../types/email.types";
import { EmailServiceTag } from "./service";

/**
 * Send new reservation notification to business
 */
export const sendNewReservationNotification = (
  reservation: Reservation,
  customer: Customer,
  locale: Locale
) =>
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;
    const dotyposConfig = yield* DotyposConfig;

    // Parse the note to extract special requests
    const parsedNote = parseNoteData(reservation.note);
    const specialRequests = parsedNote?.specialRequests;

    // Format dates and times
    const startDate = new Date(reservation.startDate);
    const endDate = new Date(reservation.endDate);
    const duration = Math.round(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
    );

    const formatDate = (date: Date) => {
      return date.toLocaleDateString("cs-CZ", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: siteConstants.workingHours.timezone,
      });
    };

    const formatTime = (date: Date) => {
      return date.toLocaleTimeString("cs-CZ", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: siteConstants.workingHours.timezone,
      });
    };

    const formattedDate = formatDate(startDate);
    const formattedTime = formatTime(startDate);

    // Build customer name
    const customerName =
      [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      customer.companyName ||
      "Guest";

    // Create the email content
    const subject = `Nová rezervace - ${customerName} - ${formattedDate} ${formattedTime}`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Nová rezervace stolů</h2>
        
        <div style="background-color: #f0f0f0; padding: 15px; border-radius: 5px; margin: 20px 0;">
          <p style="margin: 5px 0;"><strong>ID rezervace:</strong> ${reservation.id}</p>
          <p style="margin: 5px 0;"><strong>Datum:</strong> ${formattedDate}</p>
          <p style="margin: 5px 0;"><strong>Čas:</strong> ${formattedTime}</p>
          <p style="margin: 5px 0;"><strong>Doba trvání:</strong> ${duration} ${
            duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"
          }</p>
          <p style="margin: 5px 0;"><strong>Počet hostů:</strong> ${
            reservation.seats
          }</p>
        </div>

        <h3 style="color: #666;">Kontaktní údaje zákazníka:</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Jméno:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">${customerName}</td>
          </tr>
          ${
            customer.email
              ? `<tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">
              <a href="mailto:${customer.email}">${customer.email}</a>
            </td>
          </tr>`
              : ""
          }
          ${
            customer.phone
              ? `<tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Telefon:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">
              <a href="tel:${customer.phone}">${customer.phone}</a>
            </td>
          </tr>`
              : ""
          }
        </table>

        ${
          specialRequests
            ? `
        <h3 style="color: #666; margin-top: 20px;">Speciální požadavky:</h3>
        <div style="background-color: #fff3cd; padding: 12px; border-radius: 4px; border-left: 4px solid #ffc107;">
          <p style="margin: 0; white-space: pre-wrap;">${specialRequests}</p>
        </div>
        `
            : ""
        }

        <div style="margin-top: 30px; padding: 15px; background-color: #e8f5e9; border-radius: 5px;">
          <p style="margin: 5px 0; color: #2e7d32;"><strong>Akce potřebná:</strong></p>
          <p style="margin: 5px 0;">Tato rezervace čeká na potvrzení <a href="https://admin.dotypos.com/cloud/${dotyposConfig.cloudId}/reservation/${reservation.id}" rel="noopener noreferrer" target="_blank">v systému Dotypos</a>.</p>
          <p style="margin: 5px 0;">Zákazník obdržel email s informací, že rezervace byla přijata a čeká na potvrzení.</p>
        </div>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
        <p style="color: #999; font-size: 12px;">
          Jazyk zákazníka: ${locale}<br>
          Zdroj: Webový formulář<br>
          Čas přijetí: ${new Date().toLocaleString("cs-CZ")}
        </p>
      </div>
    `;

    const text = `
Nová rezervace stolů

ID rezervace: ${reservation.id}
Datum: ${formattedDate}
Čas: ${formattedTime}
Doba trvání: ${duration} ${
      duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"
    }
Počet hostů: ${reservation.seats}

Kontaktní údaje zákazníka:
- Jméno: ${customerName}
${customer.email ? `- Email: ${customer.email}` : ""}
${customer.phone ? `- Telefon: ${customer.phone}` : ""}

${specialRequests ? `Speciální požadavky:\n${specialRequests}\n` : ""}

AKCE POTŘEBNÁ:
Tato rezervace čeká na potvrzení v systému Dotypos.
Zákazník obdržel email s informací, že rezervace byla přijata a čeká na potvrzení.

---
Jazyk zákazníka: ${locale}
Zdroj: Webový formulář
Čas přijetí: ${new Date().toLocaleString("cs-CZ")}
    `.trim();

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.fromEmail,
        name: `${siteConstants.brand.name} Rezervace`,
      },
      to: {
        email: siteConstants.contact.reservationEmail,
        name: siteConstants.brand.name,
      },
      subject,
      html,
      text,
      replyTo: customer.email
        ? {
            email: customer.email,
            name: customerName,
          }
        : undefined,
      tags: ["new-reservation-notification"],
      metadata: {
        reservationId: reservation.id,
        customerId: customer.id,
        customerEmail: customer.email || "",
        source: "webhook",
      },
    };

    yield* emailService.send(emailMessage).pipe(
      Effect.tap(() => {
        return Effect.logInfo("New reservation notification sent", {
          reservationId: reservation.id,
          to: siteConstants.contact.reservationEmail,
        });
      }),
      Effect.tapError((error) => {
        return Effect.logError("Failed to send reservation notification", {
          reservationId: reservation.id,
          to: siteConstants.contact.reservationEmail,
          error,
        });
      }),
      // Don't fail if email fails
      Effect.catchAll(() => Effect.void)
    );
  }).pipe(Effect.withSpan("sendNewReservationNotification"));
