"use server";

import { Effect, Layer, Logger, LogLevel } from "effect";
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
      
      const reservationData = {
        datetime: input.datetime,
        duration: input.duration,
        guestCount: input.guestCount,
        customerName: input.name,
        customerEmail: input.email,
        customerPhone: input.phone,
        tablePreference: input.tablePreference,
        specialRequests: input.specialRequests || "",
      };
      
      yield* Effect.logDebug("Prepared reservation data", reservationData);
      
      const reservation = yield* createReservation(reservationData).pipe(
        Effect.tap((res) =>
          Effect.logInfo("Reservation created successfully", res)
        ),
        Effect.tapError((error) =>
          Effect.logError("Reservation creation failed", error)
        ),
        Effect.provide(DotyposServiceLive)
      );

      yield* Effect.logInfo("Redirecting to reservation page", {
        reservationId: reservation.id,
      });
      redirect(`/reservation/${reservation.id}`);
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
export const submitBooking = async (...args: Parameters<typeof _submitBooking>): Promise<any> => {
  "use server";
  return _submitBooking(...args);
};
