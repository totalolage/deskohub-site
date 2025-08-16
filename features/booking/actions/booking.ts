"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { createDotyposReservation } from "../backend/dotypos";
import type { BookingData } from "../booking";

const _submitBookingEffect = createEffectSafeAction(
  getBookingSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      // Prepare booking data for Dotypos
      const bookingData: BookingData = {
        id: "", // Will be set by Dotypos
        datetime: input.datetime,
        duration: input.duration,
        guestCount: input.guestCount,
        name: input.name,
        email: input.email,
        phone: input.phone,
        tablePreference: input.tablePreference,
        specialRequests: input.specialRequests || "",
        submittedAt: new Date(),
      };

      // Create reservation in Dotypos (this is our source of truth)
      const reservation = yield* createDotyposReservation(bookingData);

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
  Layer.empty // No dependencies needed for this action
);

// Server action that handles the redirect
export const submitBooking = async (input: unknown) => {
  try {
    const result = await _submitBookingEffect(input);

    if (result && typeof result === "object" && "bookingId" in result) {
      redirect(`/reservation/${result.bookingId}`);
    }

    // This shouldn't happen if the Effect succeeds
    throw new Error("Failed to create booking", { cause: result });
  } catch (error) {
    console.error("Booking submission error:", error);
    throw error;
  }
};
