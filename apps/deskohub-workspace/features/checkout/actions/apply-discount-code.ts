"use server";

import { randomUUID } from "node:crypto";
import { Effect, Layer, Predicate } from "effect";
import { RedirectType, redirect } from "next/navigation";
import {
  buildCheckoutPayPathFromToken,
  PayableReservationService,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { defaultLocale, isLocale, type Locale } from "@/features/i18n";
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

  if (result.data?.status === "unavailable" && result.data.freshPayUrl) {
    redirect(result.data.freshPayUrl, RedirectType.replace);
  }

  // Server Action arguments are client-controlled, so never build a redirect
  // path from an unvalidated locale segment.
  redirect(
    buildCheckoutPayPathFromToken(
      isLocale(locale) ? locale : defaultLocale,
      payStateToken,
      {
        discountCodeError: "unavailable",
        discountCodeErrorId: randomUUID(),
      }
    ),
    RedirectType.replace
  );
}
