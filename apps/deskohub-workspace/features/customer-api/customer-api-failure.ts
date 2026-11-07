import {
  CustomerAccountLinkRequired,
  CustomerServiceUnavailable,
  CustomerSessionRequired,
} from "@deskohub/workspace-customer-api";
import { Effect, Match } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountLinkFailure,
} from "@/features/account/customer-account";

/** The account public errors an account access failure answers with. */
export type CustomerAccountApiFailure =
  | CustomerSessionRequired
  | CustomerAccountLinkRequired
  | CustomerServiceUnavailable;

const linkRequiredReason = (
  linkReason: CustomerAccountLinkFailure | undefined
): CustomerAccountLinkRequired["reason"] =>
  Match.value(linkReason).pipe(
    Match.when("deletion-requested", () => "deletion-pending" as const),
    Match.whenOr(
      "ambiguous",
      "unusable",
      "claimed",
      () => "support-required" as const
    ),
    Match.whenOr("not-found", undefined, () => "profile-missing" as const),
    Match.exhaustive
  );

/**
 * The public error an account access failure answers with: a session that
 * is gone asks to sign in again, an account without a usable Dotypos
 * profile says why, and every other failure is unavailable.
 */
export const accountAccessApiFailure = (
  failure: CustomerAccountAccessError
): CustomerAccountApiFailure =>
  Match.value(failure.reason).pipe(
    Match.whenOr(
      "unauthenticated",
      "unverified-email",
      () => new CustomerSessionRequired()
    ),
    Match.when(
      "link-required",
      () =>
        new CustomerAccountLinkRequired({
          reason: linkRequiredReason(failure.linkReason),
        })
    ),
    Match.whenOr(
      "not-configured",
      "unavailable",
      () => new CustomerServiceUnavailable()
    ),
    Match.exhaustive
  );

/**
 * Answers an endpoint's failure with a fixed public error, logging only the
 * fixed codes it carries first: an account access failure as
 * `accountAccessApiFailure` maps it, and anything else, such as an account
 * service whose layer couldn't be built, as unavailable.
 */
export const answerCustomerApiFailure =
  (operation: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, CustomerAccountApiFailure, R> =>
    effect.pipe(
      Effect.catch((failure) => {
        const answer =
          failure instanceof CustomerAccountAccessError
            ? accountAccessApiFailure(failure)
            : new CustomerServiceUnavailable();
        return Effect.logWarning("Customer API request failed.").pipe(
          Effect.annotateLogs({
            operation,
            answer: answer._tag,
            ...(failure instanceof CustomerAccountAccessError && {
              reason: failure.reason,
              ...(failure.linkReason && { linkReason: failure.linkReason }),
              ...(failure.cause && { failureCode: failure.cause.code }),
              ...(failure.diagnostic && { diagnostic: failure.diagnostic }),
            }),
          }),
          Effect.andThen(Effect.fail(answer))
        );
      })
    );
