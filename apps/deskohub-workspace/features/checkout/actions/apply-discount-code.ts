"use server";

import { randomUUID } from "node:crypto";
import { Effect, Layer, Predicate } from "effect";
import { RedirectType, redirect } from "next/navigation";
import { env } from "@/env";
import {
  buildCheckoutPayPathFromToken,
  CheckoutReferralService,
  PayableReservationService,
} from "@/features/checkout/backend/checkout";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { addCheckoutReferralAppliedMarker } from "@/features/checkout/checkout-referral-notice";
import type { DiscountCodeRejection } from "@/features/checkout/discount-code-rejection";
import { defaultLocale, isLocale, type Locale } from "@/features/i18n";
import { ReferralService } from "@/features/referrals";
import { parseSharedReferralCode } from "@/features/referrals/referral-code-cookie";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { rememberReferralCode } from "@/features/referrals/remembered-referral-code.server";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { applyDiscountCodeSchema } from "./apply-discount-code-input";
import {
  type ApplyDiscountCodeResult,
  applyDiscountCodeToPayState,
  getApplyDiscountCodeDeadline,
} from "./apply-discount-code-to-pay-state";

const applyDiscountCodeAction = defineWorkspaceAction(
  {
    operation: "checkout.apply-discount-code",
    deadline: getApplyDiscountCodeDeadline(env.VERCEL_ENV),
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
        ).pipe(Layer.provideMerge(ReferralFeatureFlagRequest))
      )
    )
);

const applyDiscountCode: typeof applyDiscountCodeAction = async (
  ...args: Parameters<typeof applyDiscountCodeAction>
) => {
  "use server";
  return await applyDiscountCodeAction(...args);
};

const getDiscountCodeRejection = (
  status: ApplyDiscountCodeResult["status"] | undefined
): DiscountCodeRejection => {
  if (status === "already_attributed") return "referral-already-attributed";
  if (status === "ineligible") return "referral-ineligible";
  if (status === "automated_request") return "automated-request";
  return "unavailable";
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
  const freshPayUrl =
    data && "freshPayUrl" in data ? data.freshPayUrl : undefined;

  if (
    freshPayUrl &&
    (data?.status === "accepted" || data?.status === "already_accepted")
  ) {
    const acceptedCode = parseSharedReferralCode(
      Predicate.isString(submittedCode) ? submittedCode : undefined
    );
    if (acceptedCode) await rememberReferralCode(acceptedCode);
    redirect(
      addCheckoutReferralAppliedMarker(freshPayUrl, locale) ?? freshPayUrl,
      RedirectType.replace
    );
  }

  if (freshPayUrl) {
    redirect(freshPayUrl, RedirectType.replace);
  }

  // Server Action arguments are client-controlled, so never build a redirect
  // path from an unvalidated locale segment.
  redirect(
    buildCheckoutPayPathFromToken(
      isLocale(locale) ? locale : defaultLocale,
      payStateToken,
      {
        discountCodeError: getDiscountCodeRejection(data?.status),
        discountCodeErrorId: randomUUID(),
      }
    ),
    RedirectType.replace
  );
}
