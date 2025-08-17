"use server";

import { Schema } from "@effect/schema";
import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { createReservation, DotyposServiceLive } from "@/features/dotypos";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

const _submitBookingEffect = createEffectSafeAction(
  getBookingSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      // Create reservation directly in Dotypos (this is our source of truth)
      const reservation = yield* createReservation({
        datetime: input.datetime,
        duration: input.duration,
        guestCount: input.guestCount,
        customerName: input.name,
        customerEmail: input.email,
        customerPhone: input.phone,
        tablePreference: input.tablePreference,
        specialRequests: input.specialRequests || "",
      }).pipe(Effect.provide(DotyposServiceLive));

      yield* Effect.log(
        `Dotypos reservation created: ${reservation.id} (status: ${reservation.status}) for locale: ${locale}`
      );

      // Return the Dotypos reservation ID
      return { bookingId: reservation.id };
    }).pipe(
      Effect.withSpan("submitBooking", {
        attributes: {
          locale,
          input,
        },
      })
    ),
  Layer.empty // DotyposServiceLive is provided in the adapter
);

// Schema for the booking result
const BookingResultSchema = Schema.Struct({
  bookingId: Schema.String,
});

// Server action that handles the redirect
export const submitBooking = async (input: unknown) => {
  const result = await _submitBookingEffect(input);

  // Parse the result using Schema
  const parseResult = Schema.decodeUnknownOption(BookingResultSchema)(result);

  if (parseResult._tag === "Some") {
    redirect(`/reservation/${parseResult.value.bookingId}`);
  }

  // If we can't parse the result, something went wrong
  throw new Error("Failed to create booking: Invalid response format");
};
