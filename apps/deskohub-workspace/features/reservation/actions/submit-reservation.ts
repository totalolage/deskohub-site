"use server";

import { Effect } from "effect";
import { CheckoutServiceLiveWithDependencies } from "@/features/checkout/backend/checkout";
import { submitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { submitWorkspaceReservation } from "@/features/reservation/actions/submit-workspace-reservation";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const submitReservationAction = defineWorkspaceAction(
  {
    operation: "checkout.submit-reservation",
    schema: submitReservationSchema,
  },
  (input) =>
    submitWorkspaceReservation(input).pipe(
      Effect.provide(CheckoutServiceLiveWithDependencies)
    )
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
