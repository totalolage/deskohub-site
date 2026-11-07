import { Effect, Result } from "effect";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import type {
  CustomerProfileCompletionInput,
  CustomerProfileInput,
} from "../contracts";
import {
  isCustomerProfileMissing,
  type LinkedCustomerAccount,
} from "../customer-account";
import { CustomerAccountResolver } from "./customer-account-resolver.service";
import { CustomerProfileService } from "./customer-profile.service";
import { completeNewCustomerProfile } from "./profile-completion";
import { requireVerifiedSession } from "./verified-customer-session";

/**
 * Saves the profile of the current session's account: an already-linked
 * account updates its Dotypos customer, a not-yet-linked one creates and
 * claims it without a referral code.
 */
export const updateCurrentCustomerProfile = Effect.fn(
  "account.updateCurrentCustomerProfile"
)(function* (input: CustomerProfileInput) {
  yield* saveCustomerProfile(input, undefined);
  return { status: "updated" } as const;
});

/**
 * First-time profile completion of the current session's account. A
 * referral code counts only when this save creates the customer; an
 * already-linked account ignores it and just saves. Once saved, the
 * remembered referral code is forgotten if the customer's referral is
 * settled, whether by this completion or earlier. The completion field, not
 * the remembered code, decides which code this save records.
 */
export const completeCurrentCustomerProfile = Effect.fn(
  "account.completeCurrentCustomerProfile"
)(function* ({
  referralCode,
  prefilledReferralCode,
  ...input
}: CustomerProfileCompletionInput) {
  const outcome = yield* saveCustomerProfile(input, {
    code: referralCode,
    prefilledCode: prefilledReferralCode,
  });
  if (outcome.status === "referral-code-unavailable") return outcome;

  yield* forgetSettledRememberedReferral(outcome.account);
  return outcome.status === "completed" && outcome.referral
    ? { status: "completed" as const, referral: outcome.referral }
    : { status: "completed" as const };
});

type ProfileCompletionReferral = {
  readonly code: string | undefined;
  readonly prefilledCode: string | undefined;
};

/**
 * Saves the Dotypos-owned profile for the verified account: a not-yet-linked
 * account creates and claims its customer profile, an already-linked account
 * updates it. Both paths run under the authoritative session, re-check the
 * deletion marker under the account lock, and never accept an email: the
 * profile input has no email field and the verified login email is read only
 * from the session.
 */
const saveCustomerProfile = Effect.fnUntraced(function* (
  input: CustomerProfileInput,
  referral: ProfileCompletionReferral | undefined
) {
  const user = yield* requireVerifiedSession;
  const resolution = yield* CustomerAccountResolver.pipe(
    Effect.flatMap((resolver) => resolver.resolve),
    Effect.result
  );

  if (Result.isSuccess(resolution)) {
    yield* Effect.flatMap(CustomerProfileService, (profile) =>
      profile.update(resolution.success, input)
    );
    return { status: "saved", account: resolution.success } as const;
  }

  const failure = resolution.failure;
  if (isCustomerProfileMissing(failure)) {
    return yield* completeNewCustomerProfile(
      user,
      input,
      referral ?? { code: undefined, prefilledCode: undefined }
    );
  }
  return yield* failure;
});

const forgetSettledRememberedReferral = (account: LinkedCustomerAccount) =>
  Effect.flatMap(RememberedReferral, (remembered) =>
    remembered.forgetIfSettled({
      kind: "account",
      customerId: account.dotyposCustomerId,
    })
  );
