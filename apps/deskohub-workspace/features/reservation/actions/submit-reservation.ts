"use server";

import { CheckoutServiceLiveWithDependencies } from "@/features/checkout/backend/checkout";
import { submitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { submitWorkspaceReservation } from "@/features/reservation/actions/submit-workspace-reservation";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const submitReservationAction = WorkspaceEffect.action(
  {
    operation: "checkout.submit-reservation",
    schema: submitReservationSchema,
    layer: CheckoutServiceLiveWithDependencies,
  },
  ({ parsedInput }) => submitWorkspaceReservation(parsedInput)
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
