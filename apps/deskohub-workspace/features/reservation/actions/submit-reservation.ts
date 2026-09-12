"use server";

import { submitReservationEffect } from "@/features/reservation/actions/submit-reservation-composition";
import { submitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";

const submitReservationAction = defineWorkspaceAction(
  {
    operation: "checkout.submit-reservation",
    schema: submitReservationSchema,
  },
  (input) => submitReservationEffect(input)
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
