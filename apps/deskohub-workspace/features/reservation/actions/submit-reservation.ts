"use server";

import { Effect, Layer } from "effect";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { submitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { submitWorkspaceReservation } from "@/features/reservation/actions/submit-workspace-reservation";
import { ReservationAccessCookieWriter } from "@/features/reservation/backend/reservation-access-cookie.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const submitReservationAction = defineWorkspaceAction(
  {
    operation: "checkout.submit-reservation",
    schema: submitReservationSchema,
  },
  (input) =>
    submitWorkspaceReservation(input).pipe(
      Effect.provide(
        Layer.mergeAll(CheckoutService.Live, ReservationAccessCookieWriter.Live)
      )
    )
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
