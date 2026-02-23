/**
 * Send Reservation Status Emails
 *
 * Functions to send different types of reservation emails based on status
 */

import { Effect } from "effect";
import type {
  Customer,
  Reservation,
} from "@/features/dotypos/generated/types.gen";
import { parseNoteData } from "@/features/dotypos/utils/note-metadata";
import type { Locale } from "@/features/i18n";
import { EmailServiceTag } from "@/packages/email/backend/service";
import type {
  EmailMessage,
  ReservationConfirmationData,
} from "@/packages/email/types/email.types";
import { buildAbsoluteUrl } from "@/shared/backend/utils/site-url";
import { siteConstants } from "@/shared/utils/constants";
import { renderReservationConfirmedEmail } from "../templates/reservation-confirmed";
import { renderReservationCreatedEmail } from "../templates/reservation-created";
import { renderReservationDeclinedEmail } from "../templates/reservation-declined";

/**
 * Prepare reservation data for email templates
 */
function prepareReservationData(
  reservation: Reservation,
  customer: Customer
): ReservationConfirmationData {
  const startDate = new Date(reservation.startDate);
  const endDate = new Date(reservation.endDate);
  const duration = Math.round(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
  );

  return {
    customerName:
      [customer.firstName, customer.lastName]
        .filter(Boolean)
        .join(" ")
        .trim() ||
      customer.companyName ||
      "Guest",
    reservationId: reservation.id || "pending",
    datetime: startDate,
    duration,
    guestCount:
      typeof reservation.seats === "string"
        ? parseInt(reservation.seats, 10)
        : reservation.seats || 1,
    specialRequests: parseNoteData(reservation.note)?.specialRequests,
    // TODO: Add table name when available from table service
    tableName: undefined,
    // Generate full URLs for email links
    confirmationUrl: reservation.id
      ? buildAbsoluteUrl(`/reservation/${reservation.id}`)
      : undefined,
    cancelUrl: undefined, // TODO: Add cancel URL when route is available
    reservationUrl: buildAbsoluteUrl("/reservation"), // URL for making new reservations
  };
}

/**
 * Send reservation created email (pending confirmation)
 */
export const sendReservationCreatedEmail = (
  reservation: Reservation,
  customer: Customer,
  locale: Locale
) =>
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    if (!customer.email) {
      yield* Effect.logWarning(
        "Customer has no email address, skipping email",
        {
          customerId: customer.id,
          reservationId: reservation.id,
        }
      );
      return;
    }

    // Sending reservation created email

    const templateData = prepareReservationData(reservation, customer);
    const { subject, html, text } = renderReservationCreatedEmail(
      templateData,
      locale
    );

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.fromEmail,
        name: siteConstants.brand.name,
      },
      to: {
        email: customer.email,
        name: templateData.customerName,
      },
      subject,
      html,
      text,
      tags: ["reservation-created"],
      metadata: {
        reservationId: reservation.id,
        customerId: customer.id,
        status: "created",
      },
    };

    yield* emailService.send(emailMessage).pipe(
      Effect.tap(() => {
        return Effect.logInfo("Reservation created email sent", {
          reservationId: reservation.id,
          customerEmail: customer.email,
        });
      }),
      Effect.tapError((error) => {
        return Effect.logError("Failed to send reservation created email", {
          reservationId: reservation.id,
          customerEmail: customer.email,
          error,
        });
      }),
      // Don't fail if email fails
      Effect.catchAll(() => Effect.void)
    );
  }).pipe(Effect.withSpan("sendReservationCreatedEmail"));

/**
 * Send reservation confirmed email
 */
export const sendReservationConfirmedEmail = (
  reservation: Reservation,
  customer: Customer,
  locale: Locale
) =>
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    if (!customer.email) {
      yield* Effect.logWarning(
        "Customer has no email address, skipping email",
        {
          customerId: customer.id,
          reservationId: reservation.id,
        }
      );
      return;
    }

    // Sending reservation confirmed email

    const templateData = prepareReservationData(reservation, customer);
    const { subject, html, text } = renderReservationConfirmedEmail(
      templateData,
      locale
    );

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.fromEmail,
        name: siteConstants.brand.name,
      },
      to: {
        email: customer.email,
        name: templateData.customerName,
      },
      subject,
      html,
      text,
      tags: ["reservation-confirmed"],
      metadata: {
        reservationId: reservation.id,
        customerId: customer.id,
        status: "confirmed",
      },
    };

    yield* emailService.send(emailMessage).pipe(
      Effect.tap(() => {
        return Effect.logInfo("Reservation confirmed email sent", {
          reservationId: reservation.id,
          customerEmail: customer.email,
        });
      }),
      Effect.tapError((error) => {
        return Effect.logError("Failed to send reservation confirmed email", {
          reservationId: reservation.id,
          customerEmail: customer.email,
          error,
        });
      }),
      // Don't fail if email fails
      Effect.catchAll(() => Effect.void)
    );
  }).pipe(Effect.withSpan("sendReservationConfirmedEmail"));

/**
 * Send reservation declined/cancelled email
 */
export const sendReservationDeclinedEmail = (
  reservation: Reservation,
  customer: Customer,
  locale: Locale
) =>
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    if (!customer.email) {
      yield* Effect.logWarning(
        "Customer has no email address, skipping email",
        {
          customerId: customer.id,
          reservationId: reservation.id,
        }
      );
      return;
    }

    // Sending reservation declined email

    const templateData = prepareReservationData(reservation, customer);
    const { subject, html, text } = renderReservationDeclinedEmail(
      templateData,
      locale
    );

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.fromEmail,
        name: siteConstants.brand.name,
      },
      to: {
        email: customer.email,
        name: templateData.customerName,
      },
      subject,
      html,
      text,
      tags: ["reservation-declined"],
      metadata: {
        reservationId: reservation.id,
        customerId: customer.id,
        status: "declined",
      },
    };

    yield* emailService.send(emailMessage).pipe(
      Effect.tap(() => {
        return Effect.logInfo("Reservation declined email sent", {
          reservationId: reservation.id,
          customerEmail: customer.email,
        });
      }),
      Effect.tapError((error) => {
        return Effect.logError("Failed to send reservation declined email", {
          reservationId: reservation.id,
          customerEmail: customer.email,
          error,
        });
      }),
      // Don't fail if email fails
      Effect.catchAll(() => Effect.void)
    );
  }).pipe(Effect.withSpan("sendReservationDeclinedEmail"));
