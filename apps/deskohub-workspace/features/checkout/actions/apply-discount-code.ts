"use server";

import { Effect, Layer, Predicate } from "effect";
import { RedirectType, redirect } from "next/navigation";
import {
  buildCheckoutPayPathFromToken,
  PayableReservationService,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import type { Locale } from "@/features/i18n";
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
        Layer.merge(CheckoutPricingService.Live, PayableReservationService.Live)
      )
    )
);

export const applyDiscountCode: typeof applyDiscountCodeAction = async (
  ...args: Parameters<typeof applyDiscountCodeAction>
) => {
  "use server";
  return await applyDiscountCodeAction(...args);
};

export async function applyDiscountCodeForm(
  locale: Locale,
  payStateToken: string,
  formData: FormData
) {
  const submittedCode = formData.get("submittedCode");
  const result = await applyDiscountCode({
    locale,
    payStateToken,
    submittedCode: Predicate.isString(submittedCode) ? submittedCode : "",
  });

  if (
    result.data?.status === "applied" ||
    result.data?.status === "pricing_changed"
  ) {
    redirect(result.data.freshPayUrl, RedirectType.replace);
  }

  redirect(
    buildCheckoutPayPathFromToken(locale, payStateToken, {
      discountCodeError: "unavailable",
    }),
    RedirectType.replace
  );
}
