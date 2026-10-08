"use server";

import { randomUUID } from "node:crypto";
import { Effect, Layer, Predicate } from "effect";
import { RedirectType, redirect } from "next/navigation";
import {
  buildCheckoutPayPathFromToken,
  CheckoutReferralService,
  PayableReservationService,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { addCheckoutReferralAppliedMarker } from "@/features/checkout/checkout-referral-notice";
import type { Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
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
        Layer.mergeAll(
          CheckoutPricingService.Live,
          PayableReservationService.Live,
          ReferralService.Live,
          CheckoutReferralService.Live
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
    submittedCode: Predicate.isString(submittedCode) ? submittedCode : "",
  });
  const data = result.data;

  if (
    data?.freshPayUrl &&
    (data.status === "accepted" || data.status === "already_accepted")
  ) {
    const freshPayUrl =
      addCheckoutReferralAppliedMarker(data.freshPayUrl, locale) ??
      data.freshPayUrl;
    redirect(freshPayUrl, RedirectType.replace);
  }

  if (data?.freshPayUrl && data.status !== "unavailable") {
    redirect(data.freshPayUrl, RedirectType.replace);
  }

  if (data?.status === "unavailable" && data.freshPayUrl) {
    redirect(data.freshPayUrl, RedirectType.replace);
  }

  redirect(
    buildCheckoutPayPathFromToken(locale, payStateToken, {
      discountCodeError: "unavailable",
      discountCodeErrorId: randomUUID(),
    }),
    RedirectType.replace
  );
}
