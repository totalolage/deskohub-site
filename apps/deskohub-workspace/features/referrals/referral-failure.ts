import { dotyposFailureLogFields } from "@deskohub/dotypos";
import { Match } from "effect";
import type { ReferralAccountOutage, ReferralError } from "./contracts";

/**
 * Fixed log fields for a failed referral operation: a verdict's reason, or
 * the source that failed. Never the code, a customer, or a query.
 */
export const referralFailureLogFields = Match.type<
  ReferralError | ReferralAccountOutage
>().pipe(
  Match.tagsExhaustive({
    ReferralError: (error) => ({ reason: error.reason }),
    EffectDrizzleQueryError: () => ({
      reason: "outage",
      outage: "database",
    }),
    SqlError: () => ({ reason: "outage", outage: "database" }),
    ReferralAuthenticationUnavailable: ({ diagnostic }) => ({
      reason: "outage",
      outage: "authentication",
      ...(diagnostic && { diagnostic }),
    }),
    ReferralAccountCheckUnavailable: ({ code }) => ({
      reason: "outage",
      outage: "account",
      ...(code && { code }),
    }),
    DotyposUnavailable: (failure) => ({
      reason: "outage",
      outage: "dotypos",
      ...dotyposFailureLogFields(failure),
    }),
    DotyposRejected: (failure) => ({
      reason: "outage",
      outage: "dotypos",
      ...dotyposFailureLogFields(failure),
    }),
  })
);
