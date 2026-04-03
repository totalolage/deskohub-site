import { EmailServiceTag } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import type { EmailMessage } from "@/features/email/types/email.types";
import { StorageError } from "@/shared/backend/errors";
import { siteConstants } from "@/shared/utils/constants";

export interface TrainingRoomReservation {
  firstName: string;
  lastName: string;
  company: string;
  role: string;
  email: string;
  phone: string;
  date: Date;
  time: string;
  duration: number;
  specialRequirements?: string;
  submittedAt: string;
  locale?: string;
}

export interface TrainingReservationService {
  readonly submit: (
    data: Omit<TrainingRoomReservation, "submittedAt">,
    locale?: string
  ) => Effect.Effect<TrainingRoomReservation, StorageError>;
}

export const TrainingReservationService =
  Context.GenericTag<TrainingReservationService>("TrainingReservationService");

export const TrainingReservationServiceLive = Layer.effect(
  TrainingReservationService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    return TrainingReservationService.of({
      submit: (data, locale) =>
        Effect.gen(function* () {
          const reservation: TrainingRoomReservation = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale,
          };

          yield* Effect.logInfo(
            "Processing training room reservation submission",
            {
              email: data.email,
              firstName: data.firstName,
              lastName: data.lastName,
              company: data.company,
              date: data.date.toISOString(),
              time: data.time,
              locale,
            }
          );

          // Format the date and time for display
          const formattedDate = data.date.toLocaleDateString(locale, {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            timeZone: siteConstants.workingHours.timezone,
          });

          const formattedTime = data.time;
          const duration = data.duration;

          // Create email content for the business
          const displayName =
            data.company || `${data.firstName} ${data.lastName}`.trim();
          const fullName = `${data.firstName} ${data.lastName}`.trim();

          const businessEmailContent = {
            subject: `Nová rezervace školící místnosti - ${displayName}`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">Nová rezervace školící místnosti</h2>
                
                <h3 style="color: #666;">Kontaktní údaje:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  ${
                    data.firstName || data.lastName
                      ? `
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Jméno:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${fullName}</td>
                  </tr>
                  `
                      : ""
                  }
                  ${
                    data.company
                      ? `
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Společnost:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.company}</td>
                  </tr>
                  `
                      : ""
                  }
                  ${
                    data.role
                      ? `
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Pozice:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.role}</td>
                  </tr>
                  `
                      : ""
                  }
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Email:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.email}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Telefon:</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${data.phone}</td>
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
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${duration} ${
                      duration === 1
                        ? "hodina"
                        : duration < 5
                          ? "hodiny"
                          : "hodin"
                    }</td>
                  </tr>
                </table>
                
                ${
                  data.specialRequirements
                    ? `
                  <h3 style="color: #666; margin-top: 20px;">Speciální požadavky:</h3>
                  <p style="background-color: #f5f5f5; padding: 12px; border-radius: 4px;">
                    ${data.specialRequirements}
                  </p>
                `
                    : ""
                }
                
                <div style="background-color: #fff3cd; border: 1px solid #ffc107; border-radius: 4px; padding: 15px; margin-top: 20px;">
                  <h3 style="color: #856404; margin-top: 0;">⚠️ Požadovaná akce:</h3>
                  <p style="color: #856404; margin: 0;">
                    <strong>Zavolejte zákazníkovi pro potvrzení rezervace!</strong><br>
                    Telefon: <strong>${data.phone}</strong>
                  </p>
                </div>
                
                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;">
                <p style="color: #999; font-size: 12px;">
                  Tato zpráva byla automaticky vygenerována z formuláře na webu DeskoHub.
                </p>
              </div>
            `,
            text: `
Nová rezervace školící místnosti

Kontaktní údaje:
${fullName ? `- Jméno: ${fullName}\n` : ""}${data.company ? `- Společnost: ${data.company}\n` : ""}${data.role ? `- Pozice: ${data.role}\n` : ""}- Email: ${data.email}
- Telefon: ${data.phone}

Detaily rezervace:
- Datum: ${formattedDate}
- Čas: ${formattedTime}
- Doba trvání: ${duration} ${duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"}

${data.specialRequirements ? `Speciální požadavky:\n${data.specialRequirements}` : ""}

⚠️ POŽADOVANÁ AKCE:
Zavolejte zákazníkovi pro potvrzení rezervace!
Telefon: ${data.phone}

---
Tato zpráva byla automaticky vygenerována z formuláře na webu DeskoHub.
            `.trim(),
          };

          // Create the email message for business
          const businessEmailMessage: EmailMessage = {
            from: {
              email: siteConstants.contact.fromEmail,
              name: "Web Rezervace",
            },
            to: {
              email: siteConstants.contact.reservationEmail,
              name: "DeskoHub Rezervace",
            },
            subject: businessEmailContent.subject,
            html: businessEmailContent.html,
            text: businessEmailContent.text,
            replyTo: {
              email: data.email,
              name: displayName,
            },
            tags: ["training-room-reservation"],
            metadata: {
              source: "training-room-form",
              customerName: displayName,
              customerEmail: data.email,
              date: data.date.toISOString(),
              time: data.time,
              submittedAt: reservation.submittedAt,
            },
          };

          // Send the email to business - this must succeed
          yield* emailService.send(businessEmailMessage).pipe(
            Effect.tap(() =>
              Effect.logInfo(
                "Training room reservation email sent to business",
                {
                  to: siteConstants.contact.reservationEmail,
                  customerEmail: data.email,
                }
              )
            ),
            Effect.tapError((error) =>
              Effect.logError(
                "Failed to send training room reservation email to business",
                {
                  error,
                  customerEmail: data.email,
                }
              )
            ),
            Effect.mapError(
              (error) =>
                new StorageError({
                  message:
                    locale === "cs-CZ"
                      ? "Nepodařilo se odeslat rezervaci. Zkuste to prosím později."
                      : "Failed to send reservation. Please try again later.",
                  operation: "trainingReservation.submit",
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
              name: displayName,
            },
            subject:
              locale === "cs-CZ"
                ? "Potvrzení rezervace školící místnosti - DeskoHub"
                : "Training Room Reservation Confirmation - DeskoHub",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">${
                  locale === "cs-CZ"
                    ? "Potvrzení přijetí rezervace"
                    : "Reservation Received"
                }</h2>
                <p>${
                  locale === "cs-CZ"
                    ? "Děkujeme za Vaši rezervaci školící místnosti. Vaši žádost jsme úspěšně přijali a brzy Vás budeme telefonicky kontaktovat pro potvrzení všech detailů."
                    : "Thank you for your training room reservation. We have successfully received your request and will contact you by phone soon to confirm all details."
                }</p>
                
                <div style="background-color: #e8f5e9; border: 1px solid #4caf50; border-radius: 4px; padding: 15px; margin: 20px 0;">
                  <p style="color: #2e7d32; margin: 0;">
                    <strong>${locale === "cs-CZ" ? "Co bude následovat:" : "What's next:"}</strong><br>
                    ${
                      locale === "cs-CZ"
                        ? "📞 Zavoláme Vám v nejbližší pracovní době pro potvrzení rezervace a zodpovězení případných dotazů."
                        : "📞 We will call you during the next business hours to confirm your reservation and answer any questions."
                    }
                  </p>
                </div>
                
                <h3 style="color: #666;">${
                  locale === "cs-CZ"
                    ? "Detaily rezervace:"
                    : "Reservation Details:"
                }</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${
                      locale === "cs-CZ" ? "Datum:" : "Date:"
                    }</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedDate}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${
                      locale === "cs-CZ" ? "Čas:" : "Time:"
                    }</strong></td>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">${formattedTime}</td>
                  </tr>
                  <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>${
                      locale === "cs-CZ" ? "Doba trvání:" : "Duration:"
                    }</strong></td>
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
                  DeskoHub<br>
                  ${
                    locale === "cs-CZ"
                      ? "Váš prostor pro práci a kreativitu"
                      : "Your space for work and creativity"
                  }
                </p>
              </div>
            `,
            text:
              locale === "cs-CZ"
                ? `
Potvrzení přijetí rezervace

Děkujeme za Vaši rezervaci školící místnosti. Vaši žádost jsme úspěšně přijali a brzy Vás budeme telefonicky kontaktovat pro potvrzení všech detailů.

Co bude následovat:
📞 Zavoláme Vám v nejbližší pracovní době pro potvrzení rezervace a zodpovězení případných dotazů.

Detaily rezervace:
- Datum: ${formattedDate}
- Čas: ${formattedTime}
- Doba trvání: ${duration} ${duration === 1 ? "hodina" : duration < 5 ? "hodiny" : "hodin"}

Pokud máte jakékoliv dotazy, neváhejte nás kontaktovat na emailu ${siteConstants.contact.reservationEmail}.

---
DeskoHub
Váš prostor pro práci a kreativitu
                `.trim()
                : `
Reservation Received

Thank you for your training room reservation. We have successfully received your request and will contact you by phone soon to confirm all details.

What's next:
📞 We will call you during the next business hours to confirm your reservation and answer any questions.

Reservation Details:
- Date: ${formattedDate}
- Time: ${formattedTime}
- Duration: ${duration} ${duration === 1 ? "hour" : "hours"}

If you have any questions, please don't hesitate to contact us at ${siteConstants.contact.reservationEmail}.

---
DeskoHub
Your space for work and creativity
                `.trim(),
            tags: ["training-room-confirmation"],
            metadata: {
              source: "training-room-form",
              customerName: displayName,
              customerEmail: data.email,
              submittedAt: reservation.submittedAt,
            },
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

          return reservation;
        }).pipe(
          Effect.withSpan("submitTrainingRoomReservation", {
            attributes: {
              "reservation.firstName": data.firstName,
              "reservation.lastName": data.lastName,
              "reservation.company": data.company,
              "reservation.role": data.role,
              "reservation.email": data.email,
              "reservation.date": data.date.toISOString(),
              "reservation.time": data.time,
              "reservation.duration": data.duration,
            },
          })
        ),
    });
  })
);
