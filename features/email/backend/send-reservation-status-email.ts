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
import { parseNoteWithMetadata } from "@/features/dotypos/utils/note-metadata";
import type { Locale } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { renderReservationConfirmedEmail } from "../templates/reservation-confirmed";
import { renderReservationCreatedEmail } from "../templates/reservation-created";
import { renderReservationDeclinedEmail } from "../templates/reservation-declined";
import type {
  EmailMessage,
  ReservationConfirmationData,
} from "../types/email.types";
import { EmailServiceTag } from "./service";

/**
 * Prepare reservation data for email templates
 */
function prepareReservationData(
  reservation: Reservation,
  customer: Customer,
  specialRequests?: string
): ReservationConfirmationData {
  const startDate = new Date(reservation.startDate);
  const endDate = new Date(reservation.endDate);
  const duration = Math.round(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60)
  );

  // Parse the note to extract only special requests if not provided
  let finalSpecialRequests = specialRequests;
  if (!finalSpecialRequests && reservation.note) {
    const parsedNote = parseNoteWithMetadata(reservation.note);
    finalSpecialRequests = parsedNote.specialRequests;
  }

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
    specialRequests: finalSpecialRequests || undefined,
    // TODO: Add table name when available from table service
    tableName: undefined,
    // TODO: Add URLs when routes are available
    confirmationUrl: `/reservation/${reservation.id}`,
    cancelUrl: undefined,
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

    console.log("📧 Sending reservation created email to:", customer.email);

    const templateData = prepareReservationData(reservation, customer);
    const { subject, html, text } = renderReservationCreatedEmail(
      templateData,
      locale
    );

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.reservationEmail,
        name: siteConstants.name,
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
        console.log("✅ Reservation created email sent successfully");
        return Effect.logInfo("Reservation created email sent", {
          reservationId: reservation.id,
          customerEmail: customer.email,
        });
      }),
      Effect.tapError((error) => {
        console.error("❌ Failed to send reservation created email:", error);
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

    console.log("📧 Sending reservation confirmed email to:", customer.email);

    const templateData = prepareReservationData(reservation, customer);
    const { subject, html, text } = renderReservationConfirmedEmail(
      templateData,
      locale
    );

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.reservationEmail,
        name: siteConstants.name,
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
        console.log("✅ Reservation confirmed email sent successfully");
        return Effect.logInfo("Reservation confirmed email sent", {
          reservationId: reservation.id,
          customerEmail: customer.email,
        });
      }),
      Effect.tapError((error) => {
        console.error("❌ Failed to send reservation confirmed email:", error);
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

    console.log("📧 Sending reservation declined email to:", customer.email);

    const templateData = prepareReservationData(reservation, customer);
    const { subject, html, text } = renderReservationDeclinedEmail(
      templateData,
      locale
    );

    const emailMessage: EmailMessage = {
      from: {
        email: siteConstants.contact.reservationEmail,
        name: siteConstants.name,
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
        console.log("✅ Reservation declined email sent successfully");
        return Effect.logInfo("Reservation declined email sent", {
          reservationId: reservation.id,
          customerEmail: customer.email,
        });
      }),
      Effect.tapError((error) => {
        console.error("❌ Failed to send reservation declined email:", error);
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
