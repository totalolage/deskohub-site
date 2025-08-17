"use server";

import { Effect, Layer } from "effect";
import { redirect } from "next/navigation";
import { getBookingSchema } from "@/features/booking/schemas/booking";
import { createReservation, DotyposServiceLive } from "@/features/dotypos";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

export const submitBooking = createEffectSafeAction(
  getBookingSchema(),
  (input) =>
    Effect.gen(function* () {
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

      redirect(`/reservation/${reservation.id}`);
    }),
  Layer.empty
);
