"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { createReservation, DotyposServiceLive } from "@/features/dotypos";
import {
  StandaloneEmailServiceLive,
  sendReservationConfirmationEmail,
} from "@/features/email";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

// Create the action with the helper
const _submitBooking = createEffectSafeAction(
  getBookingSchema(),
  (input) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Submit booking action invoked", {
        input,
        inputKeys: Object.keys(input),
      });

      const reservation = yield* createReservation({
        datetime: input.datetime,
        duration: input.duration,
        guestCount: input.guestCount,
        name: input.name,
        email: input.email,
        phone: input.phone,
        needsLargerTable: input.needsLargerTable,
        needsPrivateSpace: input.needsPrivateSpace,
        specialRequests: input.specialRequests || "",
      }).pipe(
        Effect.tap((res) =>
          Effect.logInfo("Reservation created successfully", res)
        ),
        Effect.tapError((error) =>
          Effect.logError("Reservation creation failed", error)
        )
      );

      // Send confirmation email
      if (reservation.id) {
        // Create a simple customer object for the email
        const customer = {
          id: "",
          firstName: input.name.split(" ")[0] || input.name,
          lastName: input.name.split(" ").slice(1).join(" ") || "",
          email: input.email,
          phone: input.phone,
          // Minimal fields needed for email - cast to Customer type
        } as Parameters<typeof sendReservationConfirmationEmail>[1];

        yield* sendReservationConfirmationEmail(
          reservation,
          customer,
          input.specialRequests
        ).pipe(
          Effect.tap(() =>
            Effect.logInfo("Confirmation email sent", {
              reservationId: reservation.id,
              email: input.email,
            })
          ),
          Effect.tapError((error) =>
            Effect.logError("Failed to send confirmation email", { error })
          ),
          // Don't fail the action if email fails
          Effect.catchAll(() => Effect.void)
        );
      }

      yield* Effect.logInfo("Returning reservation for redirect", {
        reservationId: reservation.id,
      });

      // Return the reservation so we can redirect outside the Effect
      return reservation;
    }).pipe(
      Effect.withSpan("submitBooking", {
        attributes: {
          "booking.name": input.name,
          "booking.email": input.email,
          "booking.guestCount": input.guestCount,
        },
      })
    ),
  Layer.mergeAll(DotyposServiceLive, StandaloneEmailServiceLive).pipe(
    Layer.orDie
  )
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitBooking = async (
  ...args: Parameters<typeof _submitBooking>
) => {
  "use server";
  const result = await _submitBooking(...args);

  // Check if we have a successful result with an ID
  if (result?.data?.id) {
    // Redirect happens here, outside of the Effect context
    redirect(`/reservation/${result.data.id}`);
  }

  return result;
};
