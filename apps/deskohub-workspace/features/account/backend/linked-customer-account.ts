import { Effect, Match } from "effect";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
  type LinkedCustomerAccount,
} from "../customer-account";
import { CurrentCustomerAccount } from "./current-customer-account";

/** A standing `CurrentCustomerAccount.resolve` reports. */
type ResolvedStanding = Effect.Success<
  CurrentCustomerAccount["Service"]["resolve"]
>;

/**
 * Why a resolved standing has no linked account, as the access failure the
 * account's operations refuse with: a session that is gone or unverified, a
 * pending deletion, a review account, an email no Dotypos customer has or
 * only support can link, and otherwise the failure the standing carries.
 */
export const linkedAccountFailure = (
  standing: Exclude<ResolvedStanding, { readonly kind: "linked" }>
): CustomerAccountAccessError =>
  Match.value(standing).pipe(
    Match.discriminatorsExhaustive("kind")({
      "signed-out": () =>
        new CustomerAccountAccessError({ reason: "unauthenticated" }),
      unverified: () =>
        new CustomerAccountAccessError({ reason: "unverified-email" }),
      "deletion-pending": () =>
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "deletion-requested",
        }),
      review: () => customerAccountUnavailable("account.review"),
      "profile-missing": () =>
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "not-found",
        }),
      "support-required": ({ reason }) =>
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: reason,
        }),
      unavailable: ({ failure }) => failure,
    })
  );

/**
 * The current session's linked customer account, resolving the link when it
 * isn't stored yet; any other standing fails with `linkedAccountFailure`.
 */
export const requireLinkedCustomerAccount: Effect.Effect<
  LinkedCustomerAccount,
  CustomerAccountAccessError,
  CurrentCustomerAccount
> = Effect.flatMap(CurrentCustomerAccount, (current) => current.resolve).pipe(
  Effect.flatMap((standing) =>
    standing.kind === "linked"
      ? Effect.succeed(standing.account)
      : Effect.fail(linkedAccountFailure(standing))
  ),
  Effect.withSpan("account.requireLinkedCustomerAccount")
);
