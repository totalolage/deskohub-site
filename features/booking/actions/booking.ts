"use server";

import { Effect } from "effect";
import { redirect } from "next/navigation";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";
import { BookingLive } from "../backend/booking.layers";
import { BookingService } from "../backend/booking.service";

const _submitBookingEffect = createEffectSafeAction(
  getBookingSchema(),
  (input, { locale }) =>
    Effect.gen(function* () {
      const service = yield* BookingService;

      // Create the booking
      const bookingId = yield* service.createBooking({
        datetime: input.datetime,
        duration: input.duration,
        guestCount: input.guestCount,
        name: input.name,
        email: input.email,
        phone: input.phone,
        tablePreference: input.tablePreference,
        specialRequests: input.specialRequests || "",
      });

      // Log the booking creation for observability
      yield* Effect.log(
        `Booking created with ID: ${bookingId} for locale: ${locale}`
      );

      // Return the booking ID - redirect will be handled by the action
      return { bookingId };
    }).pipe(
      Effect.withSpan("submitBooking", {
        attributes: {
          locale,
          input,
        },
      })
    ),
  BookingLive
);

// Server action that handles the redirect
export const submitBooking = async (input: unknown) => {
  try {
    const result = await _submitBookingEffect(input);

    if (result && typeof result === "object" && "bookingId" in result) {
      redirect(`/reservation/${result.bookingId}`);
    }

    // This shouldn't happen if the Effect succeeds
    throw new Error("Failed to create booking");
  } catch (error) {
    console.error("Booking submission error:", error);
    throw error;
  }
};
