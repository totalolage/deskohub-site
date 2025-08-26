"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { StandaloneEmailServiceLive } from "@/features/email";
import { EmailServiceTag } from "@/features/email/backend/service";
import type { EmailMessage } from "@/features/email/types/email.types";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { siteConstants } from "@/shared/utils/constants";
import { reservationSchema } from "../schemas/reservation";

// Create the internal action
const _submitTrainingRoomReservation = createEffectSafeAction(
  reservationSchema,
  (input, context) =>
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      const locale = context.locale;

      yield* Effect.logInfo("Training room reservation submission", {
        input,
        locale,
      });

      // Format the date and time for display
      const formattedDate = input.date.toLocaleDateString(locale, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: siteConstants.workingHours.timezone,
      });

      const formattedTime = input.time;
      const duration = input.duration;

      // Create email content
      const emailContent = {
        subject: `Nová rezervace školící místnosti - ${input.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Nová rezervace školící místnosti</h2>
            
            <h3 style="color: #666;">Kontaktní údaje:</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Jméno:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${input.name}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${input.email}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Telefon:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${input.phone}</td>
              </tr>
            </table>
            
            <h3 style="color: #666; margin-top: 20px;">Detaily rezervace:</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Datum:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Čas:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedTime}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Doba trvání:</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${duration} ${duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"}</td>
              </tr>
            </table>
            
            ${
              input.specialRequirements
                ? `
              <h3 style="color: #666; margin-top: 20px;">Speciální požadavky:</h3>
              <p style="background-color: #f5f5f5; padding: 12px; border-radius: 4px;">
                ${input.specialRequirements}
              </p>
            `
                : ""
            }
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px;">
              Tato zpráva byla automaticky vygenerována z formuláře na webu DeskOHub.
            </p>
          </div>
        `,
        text: `
Nová rezervace školící místnosti

Kontaktní údaje:
- Jméno: ${input.name}
- Email: ${input.email}
- Telefon: ${input.phone}

Detaily rezervace:
- Datum: ${formattedDate}
- Čas: ${formattedTime}
- Doba trvání: ${duration} ${duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"}

${input.specialRequirements ? `Speciální požadavky:\n${input.specialRequirements}` : ""}

---
Tato zpráva byla automaticky vygenerována z formuláře na webu DeskOHub.
        `.trim(),
      };

      // Create the email message
      const emailMessage: EmailMessage = {
        from: {
          email: "noreply@deskohub.cz",
          name: "DeskOHub Rezervace",
        },
        to: {
          email: siteConstants.contact.reservationEmail,
          name: "DeskOHub Reservations",
        },
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: {
          email: input.email,
          name: input.name,
        },
        tags: ["training-room-reservation"],
        metadata: {
          source: "training-room-form",
          customerName: input.name,
          customerEmail: input.email,
          date: input.date.toISOString(),
          time: input.time,
        },
      };

      // Send the email
      const _result = yield* emailService.send(emailMessage).pipe(
        Effect.tap(() =>
          Effect.logInfo("Training room reservation email sent successfully", {
            to: siteConstants.contact.reservationEmail,
            customerEmail: input.email,
          })
        ),
        Effect.tapError((error) =>
          Effect.logError("Failed to send training room reservation email", {
            error,
            customerEmail: input.email,
          })
        )
      );

      // Also send a confirmation email to the customer
      const confirmationMessage: EmailMessage = {
        from: {
          email: "noreply@deskohub.cz",
          name: "DeskOHub",
        },
        to: {
          email: input.email,
          name: input.name,
        },
        subject:
          locale === "cs-CZ"
            ? "Potvrzení rezervace školící místnosti - DeskOHub"
            : "Training Room Reservation Confirmation - DeskOHub",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">${locale === "cs-CZ" ? "Potvrzení rezervace" : "Reservation Confirmation"}</h2>
            <p>${
              locale === "cs-CZ"
                ? "Děkujeme za Vaši rezervaci školící místnosti. Přijali jsme Vaši žádost a brzy Vás budeme kontaktovat s potvrzením."
                : "Thank you for your training room reservation. We have received your request and will contact you soon with confirmation."
            }</p>
            
            <h3 style="color: #666;">${locale === "cs-CZ" ? "Detaily rezervace:" : "Reservation Details:"}</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${locale === "cs-CZ" ? "Datum:" : "Date:"}</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${locale === "cs-CZ" ? "Čas:" : "Time:"}</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedTime}</td>
              </tr>
              <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${locale === "cs-CZ" ? "Doba trvání:" : "Duration:"}</strong></td>
                <td style="padding: 8px; border-bottom: 1px solid #eee;">${duration} ${
                  locale === "cs-CZ"
                    ? duration === 1
                      ? "hodina"
                      : duration < 5
                        ? "hodiny"
                        : "hodin"
                    : duration === 1
                      ? "hour"
                      : "hours"
                }</td>
              </tr>
            </table>
            
            <p style="margin-top: 20px;">
              ${
                locale === "cs-CZ"
                  ? `Pokud máte jakékoliv dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.reservationEmail}.`
                  : `If you have any questions, please don't hesitate to contact us at ${siteConstants.contact.reservationEmail}.`
              }
            </p>
            
            <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
            <p style="color: #999; font-size: 12px;">
              DeskOHub<br>
              ${locale === "cs-CZ" ? "Váš prostor pro práci a kreativitu" : "Your space for work and creativity"}
            </p>
          </div>
        `,
        text:
          locale === "cs-CZ"
            ? `
Potvrzení rezervace

Děkujeme za Vaši rezervaci školící místnosti. Přijali jsme Vaši žádost a brzy Vás budeme kontaktovat s potvrzením.

Detaily rezervace:
- Datum: ${formattedDate}
- Čas: ${formattedTime}
- Doba trvání: ${duration} ${duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"}

Pokud máte jakékoliv dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.reservationEmail}.

---
DeskOHub
Váš prostor pro práci a kreativitu
        `.trim()
            : `
Reservation Confirmation

Thank you for your training room reservation. We have received your request and will contact you soon with confirmation.

Reservation Details:
- Date: ${formattedDate}
- Time: ${formattedTime}
- Duration: ${duration} ${duration === 1 ? "hour" : "hours"}

If you have any questions, please don't hesitate to contact us at ${siteConstants.contact.reservationEmail}.

---
DeskOHub
Your space for work and creativity
        `.trim(),
        tags: ["training-room-confirmation"],
      };

      // Send confirmation email (don't fail if this fails)
      yield* emailService.send(confirmationMessage).pipe(
        Effect.tap(() =>
          Effect.logInfo("Confirmation email sent to customer", {
            customerEmail: input.email,
          })
        ),
        Effect.tapError((error) =>
          Effect.logWarning("Failed to send confirmation email to customer", {
            error,
            customerEmail: input.email,
          })
        ),
        Effect.catchAll(() => Effect.void)
      );

      return {
        success: true,
        message:
          locale === "cs-CZ"
            ? "Rezervace byla úspěšně odeslána"
            : "Reservation submitted successfully",
      };
    }).pipe(
      Effect.withSpan("submitTrainingRoomReservation", {
        attributes: {
          "reservation.name": input.name,
          "reservation.email": input.email,
          "reservation.date": input.date.toISOString(),
        },
      })
    ),
  StandaloneEmailServiceLive.pipe(Layer.orDie)
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitTrainingRoomReservation = async (
  ...args: Parameters<typeof _submitTrainingRoomReservation>
) => {
  "use server";
  const result = await _submitTrainingRoomReservation(...args);

  // If successful, redirect to confirmation page
  if (result?.data?.success) {
    // Redirect to static confirmation page (no ID needed)
    redirect(`/training-room/reservation/confirmation`);
  }

  return result;
};
