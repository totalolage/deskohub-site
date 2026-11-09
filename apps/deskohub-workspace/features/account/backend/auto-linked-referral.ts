import { Effect } from "effect";
import { ReferralService } from "@/features/referrals";
import type { ReferralCode } from "@/features/referrals/client";
import { referralFailureLogFields } from "@/features/referrals/referral-failure";
import type { CustomerAccountLinkResolution } from "./customer-account-resolver.service";

/**
 * Records the referral code the customer's browser remembers from a shared
 * link when this sign-in linked the account to an existing Dotypos customer.
 * Such a customer skips profile completion, so this is the sign-up moment for
 * them. An account whose link
 * already existed, including one created by profile completion, never gains a
 * referral here.
 *
 * Acceptance applies the usual set-once, self-referral, and first-booking
 * rules and takes the account lock itself, so run this only after resolution
 * has released it. A rejected code or a failure is logged with a fixed code
 * and its reason or failed source, never the code value, and never blocks
 * sign-in.
 */
export const acceptAutoLinkedReferral = Effect.fn(
  "account.acceptAutoLinkedReferral"
)(function* (
  resolution: CustomerAccountLinkResolution,
  referralCode: ReferralCode | undefined
) {
  if (!resolution.autoLinked || referralCode === undefined) return;

  const referrals = yield* ReferralService;
  yield* referrals
    .acceptReferral({
      code: referralCode,
      customerAccountId: resolution.account.accountId,
      dotyposCustomerId: resolution.account.dotyposCustomerId,
    })
    .pipe(
      Effect.asVoid,
      Effect.catch((error) =>
        Effect.logWarning("Referral was not recorded at sign-in").pipe(
          Effect.annotateLogs({
            code: "account.auto-link.referral",
            ...referralFailureLogFields(error),
          })
        )
      )
    );
});
