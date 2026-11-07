import { Effect } from "effect";
import type { LinkedCustomerAccount } from "@/features/account/customer-account";
import { ReferralService } from "@/features/referrals";
import { getReferralShareUrl } from "@/features/referrals/client";
import type { ReferralAccountOverview } from "@/features/referrals/contracts";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { requireAccountFeature } from "./account-feature-withheld";
import { CustomerAccountResolver } from "./customer-account-resolver.service";

/** The linked account's referral summary and absolute share link. */
export const accountReferralOverview = (account: LinkedCustomerAccount) =>
  Effect.flatMap(ReferralService, (service) =>
    service.getAccountSummary({
      customerAccountId: account.accountId,
      dotyposCustomerId: account.dotyposCustomerId,
    })
  ).pipe(
    Effect.flatMap((summary) =>
      getWorkspaceRuntimeCallbackOrigin.pipe(
        Effect.map(
          (origin): ReferralAccountOverview => ({
            summary,
            shareUrl: getReferralShareUrl(summary.code, origin),
          })
        )
      )
    )
  );

/**
 * The current session's referral overview, while the referral program is
 * released. A withheld program fails with `AccountFeatureWithheldError`
 * before the account is resolved, so an overview served on its own, such as
 * the customer API's, enforces the gate the account page applies.
 *
 * The account state reads the same gate itself, because there a withheld
 * program hides the section and an unreadable overview degrades it.
 */
export const currentReferralOverview = Effect.fn(
  "account.currentReferralOverview"
)(function* () {
  yield* requireAccountFeature("referrals", ReferralReleaseGate.isOpen);
  const account = yield* Effect.flatMap(
    CustomerAccountResolver,
    (resolver) => resolver.resolve
  );
  return yield* accountReferralOverview(account);
});
