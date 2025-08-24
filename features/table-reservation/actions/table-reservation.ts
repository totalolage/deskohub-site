"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { getTableReservationSchema } from "@/features/table-reservation/schemas/table-reservation";
import { createReservation, DotyposServiceLive } from "@/features/dotypos";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

// Create the action with the helper
const _submitTableReservation = createEffectSafeAction(
  getTableReservationSchema(),
  (input) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("Submit table reservation action invoked", {
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
      Effect.withSpan("submitTableReservation", {
        attributes: {
          "tableReservation.name": input.name,
          "tableReservation.email": input.email,
          "tableReservation.guestCount": input.guestCount,
        },
      })
    ),
  DotyposServiceLive.pipe(Layer.orDie)
);

// Export an explicitly async wrapper that Next.js will recognize
export const submitTableReservation = async (
  ...args: Parameters<typeof _submitTableReservation>
) => {
  "use server";
  const result = await _submitTableReservation(...args);

  // Check if we have a successful result with an ID
  if (result?.data?.id) {
    // Redirect happens here, outside of the Effect context
    redirect(`/reservation/${result.data.id}`);
  }

  return result;
};
