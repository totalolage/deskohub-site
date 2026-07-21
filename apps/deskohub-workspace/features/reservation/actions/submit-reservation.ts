"use server";

import { Layer } from "effect";
import { CheckoutServiceLiveWithDependencies } from "@/features/checkout/backend/checkout";
import { getSubmitReservationSchema } from "@/features/reservation/actions/submit-reservation-input";
import { submitWorkspaceReservation } from "@/features/reservation/actions/submit-workspace-reservation";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { createEffectSafeAction } from "@/shared/backend/utils/effect-safe-action";

const submitReservationAction = createEffectSafeAction(
  getSubmitReservationSchema(),
  submitWorkspaceReservation,
  Layer.merge(CheckoutServiceLiveWithDependencies, BotProtectionService.Live)
);

export const submitReservation: typeof submitReservationAction = async (
  ...args: Parameters<typeof submitReservationAction>
) => {
  "use server";
  return await submitReservationAction(...args);
};
