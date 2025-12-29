"use server";

import { track } from "@vercel/analytics/server";
import { Effect } from "effect";
import { redirect } from "next/navigation";
import { DotyposService } from "@/features/dotypos";
import { getTableReservationSchema } from "@/features/table-reservation/schemas/table-reservation";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

// Create the action with the helper
const _submitTableReservation = createEffectSafeAction(
  getTableReservationSchema(),
  Effect.fn(function* (input) {
    yield* Effect.logInfo("Submit table reservation action invoked", {
      input,
      inputKeys: Object.keys(input),
    });

    const dotypos = yield* DotyposService;

    const reservation = yield* dotypos.createReservation(input).pipe(
      Effect.tap((res) => {
        // Track successful reservation on server
        track("Table Reservation Success", {
          guestCount: input.guestCount,
          duration: input.duration,
        });
        return Effect.logInfo("Reservation created successfully", res);
      }),
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
  }),
  DotyposService.Default
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
