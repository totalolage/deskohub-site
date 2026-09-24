import { type EmailMessage, EmailServiceTag } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import type { Locale } from "@/features/i18n";
import { m } from "@/features/i18n/paraglide/messages";
import { BoardgameEmailLayer } from "@/shared/backend/config/email.config";
import { StorageError } from "@/shared/backend/errors";
import { siteConstants } from "@/shared/utils/constants";
import { formatDurationMinutes } from "@/shared/utils/date-formatting";
import {
  renderBusinessTrainingReservationEmailHtml,
  renderTrainingReservationConfirmationEmailHtml,
} from "./training-reservation-email-rendering";

const businessEmailLocale: Locale = "cs-CZ";

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
  locale: Locale;
}

export interface ITrainingReservationService {
  readonly submit: (
    data: Omit<TrainingRoomReservation, "locale" | "submittedAt">,
    locale: Locale
  ) => Effect.Effect<TrainingRoomReservation, StorageError>;
}

export class TrainingReservationService extends Context.Service<
  TrainingReservationService,
  ITrainingReservationService
>()("TrainingReservationService") {
  static Default = Layer.effect(
    this,
    Effect.suspend(() => trainingReservationServiceImplementation)
  );

  static Live = this.Default.pipe(Layer.provide(BoardgameEmailLayer));
}

const trainingReservationServiceImplementation = Effect.gen(function* () {
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
        const businessFormattedDuration = formatDurationMinutes(
          data.duration * 60,
          businessEmailLocale
        );
        const customerFormattedDuration = formatDurationMinutes(
          data.duration * 60,
          locale
        );

        // Create email content for the business
        const displayName =
          data.company || `${data.firstName} ${data.lastName}`.trim();
        const fullName = `${data.firstName} ${data.lastName}`.trim();

        const businessEmailContent = {
          subject: m["trainingReservation.email.businessSubject"](
            { name: displayName },
            { locale: businessEmailLocale }
          ),
          html: renderBusinessTrainingReservationEmailHtml({
            fullName,
            company: data.company,
            role: data.role,
            email: data.email,
            phone: data.phone,
            formattedDate,
            formattedTime,
            formattedDuration: businessFormattedDuration,
            specialRequirements: data.specialRequirements,
          }),
          text: `${m["trainingReservation.email.businessText"](
            {
              nameLine: fullName
                ? m["trainingReservation.email.businessNameLine"](
                    { fullName },
                    { locale: businessEmailLocale }
                  )
                : "",
              companyLine: data.company
                ? m["trainingReservation.email.businessCompanyLine"](
                    { company: data.company },
                    { locale: businessEmailLocale }
                  )
                : "",
              roleLine: data.role
                ? m["trainingReservation.email.businessRoleLine"](
                    { role: data.role },
                    { locale: businessEmailLocale }
                  )
                : "",
              email: data.email,
              phone: data.phone,
              date: formattedDate,
              time: formattedTime,
              duration: businessFormattedDuration,
              specialRequirementsSection: data.specialRequirements
                ? m[
                    "trainingReservation.email.businessSpecialRequirementsSection"
                  ](
                    { specialRequirements: data.specialRequirements },
                    { locale: businessEmailLocale }
                  )
                : "",
            },
            { locale: businessEmailLocale }
          )}\n\n---\n${m["trainingReservation.email.footer"](undefined, {
            locale: businessEmailLocale,
          })}`,
        };

        // Create the email message for business
        const businessEmailMessage: EmailMessage = {
          from: {
            email: siteConstants.contact.fromEmail,
            name: m["trainingReservation.email.fromName"](undefined, {
              locale: businessEmailLocale,
            }),
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
            Effect.logInfo("Training room reservation email sent to business", {
              to: siteConstants.contact.reservationEmail,
              customerEmail: data.email,
            })
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
                message: m["trainingReservation.submitFailed"](undefined, {
                  locale,
                }),
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
          subject: m["trainingReservation.email.confirmationSubject"](
            undefined,
            { locale }
          ),
          html: renderTrainingReservationConfirmationEmailHtml({
            locale,
            formattedDate,
            formattedTime,
            formattedDuration: customerFormattedDuration,
          }),
          text: m["trainingReservation.email.confirmationText"](
            {
              date: formattedDate,
              time: formattedTime,
              duration: customerFormattedDuration,
              contactLine: m[
                "trainingReservation.email.confirmationContactLine"
              ](
                { contactEmail: siteConstants.contact.reservationEmail },
                { locale }
              ),
            },
            { locale }
          ),
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
            Effect.logWarning("Failed to send confirmation email to customer", {
              error,
              confirmationMessage,
              customerEmail: data.email,
            })
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
});
