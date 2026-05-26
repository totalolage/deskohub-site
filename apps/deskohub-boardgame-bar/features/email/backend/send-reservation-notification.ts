/**
 * Send Reservation Notification to Business
 *
 * Functions to send notification emails to the business about new reservations
 */

import type {
  Customer,
  Reservation,
} from "@deskohub/dotypos/generated/types.gen";
import { EmailServiceTag } from "@deskohub/email/backend/service";
import type { EmailMessage } from "@deskohub/email/types/email.types";
import { Effect } from "effect";
import { parseNoteData } from "@/features/dotypos/utils/note-metadata";
import type { Locale } from "@/features/i18n";
import { DotyposConfig } from "@/shared/backend/config/dotypos.config";
import { siteConstants } from "@/shared/utils/constants";
import { renderReservationNotificationEmailHtml } from "./reservation-notification-email-rendering";

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
    const reservationId = reservation.id ?? "pending";
    const adminReservationUrl = `https://admin.dotypos.com/cloud/${dotyposConfig.cloudId}/reservation/${reservationId}`;
    const receivedAt = new Date().toLocaleString("cs-CZ");

    // Build customer name
    const customerName =
      [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      customer.companyName ||
      "Guest";
    const customerEmail = customer.email ?? undefined;
    const customerPhone = customer.phone ?? undefined;

    // Create the email content
    const subject = `Nová rezervace - ${customerName} - ${formattedDate} ${formattedTime}`;

    const html = renderReservationNotificationEmailHtml({
      reservation,
      customerName,
      customerEmail,
      customerPhone,
      formattedDate,
      formattedTime,
      duration,
      specialRequests,
      adminReservationUrl,
      locale,
      receivedAt,
    });

    const text = `
Nová rezervace stolů

ID rezervace: ${reservationId}
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
Čas přijetí: ${receivedAt}
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
        reservationId,
        customerId: customer.id,
        customerEmail: customer.email || "",
        source: "webhook",
      },
    };

    yield* emailService.send(emailMessage).pipe(
      Effect.tap(() => {
        return Effect.logInfo("New reservation notification sent", {
          reservationId,
          to: siteConstants.contact.reservationEmail,
        });
      }),
      Effect.tapError((error) => {
        return Effect.logError("Failed to send reservation notification", {
          reservationId,
          to: siteConstants.contact.reservationEmail,
          error,
        });
      }),
      // Don't fail if email fails
      Effect.catchAll(() => Effect.void)
    );
  }).pipe(Effect.withSpan("sendNewReservationNotification"));
