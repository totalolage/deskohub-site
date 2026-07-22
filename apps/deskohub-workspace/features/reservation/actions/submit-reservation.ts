"use server";

import { Layer } from "effect";
import { CheckoutServiceLiveWithDependencies } from "@/features/checkout/backend/checkout";
import { getSubmitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { submitWorkspaceReservation } from "@/features/reservation/actions/submit-workspace-reservation";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";

const submitReservationAction = WorkspaceEffect.action(
  {
    operation: "checkout.submit-reservation",
    schema: getSubmitReservationSchema(),
    layer: Layer.merge(
      CheckoutServiceLiveWithDependencies,
      BotProtectionService.Live
    ),
  },
  ({ ctx, parsedInput }) => submitWorkspaceReservation(parsedInput, ctx)
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
