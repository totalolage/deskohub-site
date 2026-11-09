import type {
  CustomerAccountState,
  ProfileCompletionReferralOutcome,
} from "@deskohub/workspace-customer-api";
import { Effect, Match, Option } from "effect";
import { CustomerApi } from "../../customer-api/customer-api.service";
import {
  accountAtom,
  customerDataRuntime,
} from "../../customer-api/customer-data-runtime";
import {
  customerWrite,
  refreshAfterWrite,
} from "../../customer-api/customer-request";

/**
 * The stored outcome of the referral code the customer completed their
 * profile with, shown until they dismiss it; only while referrals are on.
 */
export const signupReferralOf = (
  account: CustomerAccountState
): Option.Option<ProfileCompletionReferralOutcome> =>
  account.kind === "linked" && account.referralsEnabled
    ? Option.fromNullishOr(account.signupReferral)
    : Option.none();

/** What the outcome tells the customer; the screen picks the copy. */
export type SignupReferralMessage =
  | "applied"
  | "pending"
  | "already-referred"
  | "not-eligible"
  | "code-unusable"
  | "profile-already-completed";

export const signupReferralMessage = (
  outcome: ProfileCompletionReferralOutcome
): SignupReferralMessage =>
  Match.value(outcome).pipe(
    Match.discriminatorsExhaustive("status")({
      applied: () => "applied" as const,
      pending: () => "pending" as const,
      "not-applied": ({ reason }) => reason,
    })
  );

/** A pending code is retried on a later visit, so it can't be dismissed. */
export const isDismissible = (outcome: ProfileCompletionReferralOutcome) =>
  outcome.status !== "pending";

/**
 * Dismisses the stored outcome (POST /account/referrals/signup-acknowledgement)
 * and reads the account again, which no longer carries it.
 */
export const acknowledgeSignupReferralAtom = customerDataRuntime.fn(
  (_: undefined, get) =>
    Effect.flatMap(Effect.service(CustomerApi), (api) =>
      api.account.acknowledgeSignupReferral()
    ).pipe(customerWrite, refreshAfterWrite(get, [accountAtom]))
);
