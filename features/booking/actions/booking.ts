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
        ),
        Effect.provide(DotyposServiceLive)
      );

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
  Layer.empty
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
