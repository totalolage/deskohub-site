"use server";

import { Effect, Layer } from "effect";
import { RedirectType, redirect } from "next/navigation";
import {
  discountCodeErrorQueryParam,
  PayableReservationService,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { payStateTokenQueryParam } from "@/features/checkout/backend/checkout/pay-state";
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

export async function applyDiscountCodeForm(
  locale: Locale,
  payStateToken: string,
  formData: FormData
) {
  const submittedCode = formData.get("submittedCode");
  const result = await applyDiscountCode({
    locale,
    payStateToken,
    submittedCode: typeof submittedCode === "string" ? submittedCode : "",
  }).catch(() => undefined);

  if (
    result?.data?.status === "applied" ||
    result?.data?.status === "pricing_changed"
  ) {
    redirect(result.data.freshPayUrl, RedirectType.replace);
  }

  const searchParams = new URLSearchParams({
    [payStateTokenQueryParam]: payStateToken,
    [discountCodeErrorQueryParam]: "unavailable",
  });
  redirect(`/${locale}/checkout/pay?${searchParams}`, RedirectType.replace);
}
