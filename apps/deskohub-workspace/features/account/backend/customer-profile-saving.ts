import { Effect, Match } from "effect";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import type {
  CustomerProfileCompletionSave,
  CustomerProfileSave,
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
export const updateCurrentCustomerProfile = (input: CustomerProfileSave) =>
  saveCustomerProfile(input, noReferral).pipe(
    Effect.as({ status: "updated" } as const),
    Effect.withSpan("account.updateCurrentCustomerProfile")
  );

/**
 * First-time profile completion of the current session's account. A
 * referral code counts only when this save creates the customer; an
 * already-linked account ignores it and just saves. Once saved, the
 * remembered referral code is forgotten if the customer's referral is
 * settled, whether by this completion or earlier. The completion field, not
 * the remembered code, decides which code this save records.
 *
 * A client that keeps the remembered code itself (`RememberedReferral.fromClient`)
 * can't be told to forget it from here: forgetting does nothing, and an
 * already-linked account's result carries no referral. Such a client reads
 * the account state after completing, whose `rememberedReferralCodeUsed`
 * says whether the code it sent is settled, and never forgets the code just
 * because completion succeeded.
 */
export const completeCurrentCustomerProfile = ({
  referralCode,
  prefilledReferralCode,
  ...input
}: CustomerProfileCompletionSave) =>
  saveCustomerProfile(input, {
    code: referralCode,
    prefilledCode: prefilledReferralCode,
  }).pipe(
    Effect.flatMap((outcome) =>
      Match.value(outcome).pipe(
        Match.discriminatorsExhaustive("status")({
          "referral-code-unavailable": (unavailable) =>
            Effect.succeed(unavailable),
          saved: ({ account }) =>
            forgetSettledRememberedReferral(account).pipe(
              Effect.as({ status: "completed" } as const)
            ),
          completed: ({ account, referral }) =>
            forgetSettledRememberedReferral(account).pipe(
              Effect.as(
                referral
                  ? ({ status: "completed", referral } as const)
                  : ({ status: "completed" } as const)
              )
            ),
        })
      )
    ),
    Effect.withSpan("account.completeCurrentCustomerProfile")
  );

type ProfileCompletionReferral = {
  readonly code: string | undefined;
  readonly prefilledCode: string | undefined;
};

const noReferral: ProfileCompletionReferral = {
  code: undefined,
  prefilledCode: undefined,
};

/**
 * Saves the Dotypos-owned profile for the verified account: a not-yet-linked
 * account creates and claims its customer profile, an already-linked account
 * updates it. Both paths run under the authoritative session, re-check the
 * deletion marker under the account lock, and never accept an email: the
 * profile input has no email field and the verified login email is read only
 * from the session.
 */
const saveCustomerProfile = (
  input: CustomerProfileSave,
  referral: ProfileCompletionReferral
) =>
  Effect.Do.pipe(
    Effect.bind("user", () => requireVerifiedSession),
    Effect.bind("resolution", () => resolveSavingAccount),
    Effect.flatMap(({ user, resolution }) =>
      Match.value(resolution).pipe(
        Match.discriminatorsExhaustive("kind")({
          linked: ({ account }) => updateLinkedProfile(account, input),
          "profile-missing": () =>
            completeNewCustomerProfile(user, input, referral),
        })
      )
    )
  );

/**
 * The session's linked account, or that no Dotypos profile matches it yet.
 * Every other resolution failure fails the save.
 */
const resolveSavingAccount = Effect.flatMap(
  CustomerAccountResolver,
  (resolver) => resolver.resolve
).pipe(
  Effect.map((account) => ({ kind: "linked", account }) as const),
  Effect.catchIf(isCustomerProfileMissing, () =>
    Effect.succeed({ kind: "profile-missing" } as const)
  )
);

const updateLinkedProfile = (
  account: LinkedCustomerAccount,
  input: CustomerProfileSave
) =>
  Effect.flatMap(CustomerProfileService, (profile) =>
    profile.update(account, input)
  ).pipe(Effect.as({ status: "saved", account } as const));

const forgetSettledRememberedReferral = (account: LinkedCustomerAccount) =>
  Effect.flatMap(RememberedReferral, (remembered) =>
    remembered.forgetIfSettled({
      kind: "account",
      customerId: account.dotyposCustomerId,
    })
  );
