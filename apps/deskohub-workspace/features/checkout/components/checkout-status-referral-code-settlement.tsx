import "server-only";

import { Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import {
  type CheckoutStatusKind,
  checkoutStatusTraits,
} from "@/features/checkout/checkout-status-kind";
import { ReferralService } from "@/features/referrals";
import { ForgetRememberedReferralCode } from "@/features/referrals/forget-remembered-referral-code";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";

/**
 * Whether the status page forgets the browser's remembered referral code: its
 * order is paid and the booker's own referral is settled. The payment
 * recorded any carried referral, and the booker's first paid order closes
 * their window. An order booked for someone else keeps the booker's code. An
 * unauthorized visit shows `not_found` and keeps the code.
 */
export const isRememberedReferralSettledByStatus = Effect.fn(
  "checkout.isRememberedReferralSettledByStatus"
)(function* (status: CheckoutStatusKind) {
  if (!checkoutStatusTraits[status].paid) return false;
  const remembered = yield* RememberedReferral;
  return yield* remembered.isSettled({ kind: "order", paid: true });
});

/**
 * The status page is the first response that knows the order is paid,
 * because the provider return only redirects here and reconciliation runs on
 * this render. A Server Component can't write cookies, so the browser
 * forgets the code.
 */
export async function CheckoutStatusReferralCodeSettlement({
  status,
}: {
  readonly status: CheckoutStatusKind;
}) {
  if (!checkoutStatusTraits[status].paid) return null;
  const settled = await isRememberedReferralSettledByStatus(status).pipe(
    Effect.provide(
      RememberedReferral.Cookies.pipe(
        Layer.provide(
          Layer.mergeAll(
            CustomerAccountContactService.Live,
            ReferralService.Live
          ).pipe(Layer.provideMerge(ReferralFeatureFlagRequest))
        )
      )
    ),
    // A settlement that can't be checked keeps the code.
    runWorkspaceEffectOrElse("checkout.remembered-referral-code", {
      boundary: "page",
      failureCode: "referrals.remembered-referral.unavailable",
      orElse: () => false,
    })
  );
  return settled ? <ForgetRememberedReferralCode /> : null;
}
