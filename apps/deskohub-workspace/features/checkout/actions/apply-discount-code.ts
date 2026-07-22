"use server";

import { Effect, Layer } from "effect";
import { PayableReservationService } from "@/features/checkout/backend/checkout";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { applyDiscountCodeSchema } from "./apply-discount-code-input";
import { applyDiscountCodeToPayState } from "./apply-discount-code-to-pay-state";

const applyDiscountCodeAction = defineWorkspaceAction(
  {
    operation: "checkout.apply-discount-code",
    schema: applyDiscountCodeSchema,
  },
  (input) =>
    applyDiscountCodeToPayState(input).pipe(
      Effect.provide(
        Layer.merge(
          CheckoutPricingServiceLiveWithDependencies,
          PayableReservationService.LiveWithDependencies
        )
      )
    )
);

export const applyDiscountCode: typeof applyDiscountCodeAction = async (
  ...args: Parameters<typeof applyDiscountCodeAction>
) => {
  "use server";
  return await applyDiscountCodeAction(...args);
};
