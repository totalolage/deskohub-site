import { Effect, Match } from "effect";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import type {
  CustomerProfileCompletionSave,
  CustomerProfileSave,
} from "../contracts";
import type { LinkedCustomerAccount } from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";
import { CustomerProfileService } from "./customer-profile.service";
import { linkedAccountFailure } from "./linked-customer-account";
import { completeNewCustomerProfile } from "./profile-completion";

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
 * from the session. Every other standing fails the save with
 * `linkedAccountFailure`.
 */
const saveCustomerProfile = Effect.fn(function* (
  input: CustomerProfileSave,
  referral: ProfileCompletionReferral
) {
  const current = yield* CurrentCustomerAccount;
  const standing = yield* current.resolve;
  if (standing.kind === "linked") {
    return yield* updateLinkedProfile(standing.account, input);
  }
  if (standing.kind === "profile-missing") {
    return yield* completeNewCustomerProfile(standing.session, input, referral);
  }
  return yield* linkedAccountFailure(standing);
});

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
