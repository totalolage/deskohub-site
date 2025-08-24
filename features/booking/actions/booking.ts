"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { createReservation, DotyposServiceLive } from "@/features/dotypos";
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

      const reservation = yield* createReservation(input).pipe(
        Effect.tap((res) =>
          Effect.logInfo("Reservation created successfully", res)
        ),
        Effect.tapError((error) =>
          Effect.logError("Reservation creation failed", error)
        )
      );

      // Emails are now sent via webhook when Dotypos processes the reservation
      // This ensures consistent email handling and proper status tracking

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
  DotyposServiceLive.pipe(Layer.orDie)
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
