import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import { StorageError } from "@/shared/backend/errors";
import { siteConstants } from "@/shared/utils/constants";
import {
  renderBusinessTrainingReservationEmailHtml,
  renderTrainingReservationConfirmationEmailHtml,
} from "./training-reservation-email-rendering";

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
  Context.Service<TrainingReservationService>("TrainingReservationService");

export const TrainingReservationServiceLive = Layer.effect(
  TrainingReservationService,
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    return TrainingReservationService.of({
      submit: Effect.fn("trainingReservation.submit")(
        function* (data, locale) {
          yield* Effect.annotateLogsScoped({ data, locale });
          yield* Effect.logInfo(
            "Training room reservation submission service started"
          );

          const reservation: TrainingRoomReservation = {
            ...data,
            submittedAt: new Date().toISOString(),
            locale,
          };
          yield* Effect.annotateLogsScoped({ reservation });

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
            html: renderBusinessTrainingReservationEmailHtml({
              fullName,
              company: data.company,
              role: data.role,
              email: data.email,
              phone: data.phone,
              formattedDate,
              formattedTime,
              duration,
              specialRequirements: data.specialRequirements,
            }),
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
          yield* Effect.annotateLogsScoped({ businessEmailMessage });
          yield* Effect.logInfo("Training room business email prepared");

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
                  businessEmailMessage,
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
            html: renderTrainingReservationConfirmationEmailHtml({
              locale,
              formattedDate,
              formattedTime,
              duration,
            }),
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
          yield* Effect.annotateLogsScoped({ confirmationMessage });
          yield* Effect.logInfo("Training room confirmation email prepared");

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

          yield* Effect.logDebug(
            "Training room reservation submission service completed"
          );

          return reservation;
        },
        (effect, data) =>
          effect.pipe(
            Effect.scoped,
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
          )
      ),
    });
  })
);
