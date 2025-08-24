/**
 * Send Reservation Email
 *
 * Direct function to send reservation confirmation emails
 */

import { Effect } from "effect";
import type {
  Customer,
  Reservation,
} from "@/features/dotypos/generated/types.gen";
import type { ReservationConfirmationData } from "../types/email.types";
import { EmailServiceTag } from "./service";

/**
 * Send a reservation confirmation email
 */
export const sendReservationConfirmationEmail = (
  reservation: Reservation,
  customer: Customer,
  specialRequests?: string
) =>
  Effect.gen(function* () {
    const emailService = yield* EmailServiceTag;

    // Only send email if customer has an email address
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

    // Sending reservation confirmation email

    // Prepare template data
    const templateData: ReservationConfirmationData = {
      customerName: `${customer.firstName} ${customer.lastName}`.trim(),
      reservationId: reservation.id || "pending",
      datetime: new Date(reservation.startDate),
      duration: Math.round(
        (new Date(reservation.endDate).getTime() -
          new Date(reservation.startDate).getTime()) /
          (1000 * 60 * 60)
      ),
      guestCount: parseInt(reservation.seats, 10),
      specialRequests,
      // TODO: Add table name from table service
      // TODO: Add confirmation and cancel URLs when routes are available
    };

    // Send the email
    yield* emailService
      .sendTemplate(
        {
          email: customer.email,
          name: templateData.customerName,
        },
        {
          type: "reservation-confirmation",
          data: templateData,
        }
      )
      .pipe(
        Effect.tap(() => {
          return Effect.logInfo("Reservation confirmation email sent", {
            reservationId: reservation.id,
            customerEmail: customer.email,
          });
        }),
        Effect.tapError((error) => {
          return Effect.logError(
            "Failed to send reservation confirmation email",
            {
              reservationId: reservation.id,
              customerEmail: customer.email,
              error,
            }
          );
        }),
        // Don't fail if email fails
        Effect.catchAll(() => Effect.void)
      );
  }).pipe(Effect.withSpan("sendReservationConfirmationEmail"));
