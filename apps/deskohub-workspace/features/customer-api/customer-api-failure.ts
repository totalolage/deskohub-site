import {
  CustomerAccountLinkRequired,
  CustomerFeatureUnavailable,
  CustomerServiceUnavailable,
  CustomerSessionRequired,
} from "@deskohub/workspace-customer-api";
import { Effect, Match, Predicate } from "effect";
import { AccountFeatureWithheldError } from "@/features/account/backend/account-feature-withheld";
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
 * The public errors an endpoint's failures answer with: the account access
 * errors, and `CustomerFeatureUnavailable` for an endpoint whose operation
 * can withhold its feature.
 */
export type CustomerApiFailure<E> =
  | CustomerAccountApiFailure
  | ([Extract<E, AccountFeatureWithheldError>] extends [never]
      ? never
      : CustomerFeatureUnavailable);

type FailureAnswer<E> = {
  readonly answer: CustomerApiFailure<E>;
  /** The fixed codes the failure's log carries; never a raw cause. */
  readonly codes: Readonly<Record<string, string>>;
};

const answerFailure = <E>(failure: E): FailureAnswer<E> => {
  if (failure instanceof CustomerAccountAccessError) {
    return {
      answer: accountAccessApiFailure(failure),
      codes: {
        reason: failure.reason,
        ...(failure.linkReason && { linkReason: failure.linkReason }),
        ...(failure.cause && { failureCode: failure.cause.code }),
        ...(failure.diagnostic && { diagnostic: failure.diagnostic }),
      },
    };
  }
  if (failure instanceof AccountFeatureWithheldError) {
    return {
      // Only an operation that can withhold its feature fails this way.
      answer: new CustomerFeatureUnavailable({
        feature: failure.feature,
      }) as CustomerApiFailure<E>,
      codes: { feature: failure.feature },
    };
  }
  return {
    answer: new CustomerServiceUnavailable(),
    codes:
      Predicate.hasProperty(failure, "_tag") && Predicate.isString(failure._tag)
        ? { failure: failure._tag }
        : {},
  };
};

/**
 * Answers an endpoint's failure with a fixed public error, logging only the
 * fixed codes it carries first: an account access failure as
 * `accountAccessApiFailure` maps it, a withheld feature as unavailable until
 * released, and anything else, such as an account service whose layer
 * couldn't be built, as unavailable.
 */
export const answerCustomerApiFailure =
  (operation: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, CustomerApiFailure<E>, R> =>
    effect.pipe(
      Effect.catch((failure) => {
        const { answer, codes } = answerFailure(failure);
        return logFailedRequest(operation, answer._tag, codes).pipe(
          Effect.andThen(Effect.fail(answer))
        );
      })
    );

/**
 * The public errors of an endpoint that reads only the session, never the
 * account's Dotypos link.
 */
export type CustomerSessionApiFailure<E> = Exclude<
  CustomerApiFailure<E>,
  CustomerAccountLinkRequired
>;

/**
 * Answers the failure of an endpoint that reads only the session, such as
 * its passkeys, like `answerCustomerApiFailure`. Such an operation can't
 * require the account's Dotypos link, so a link failure is unavailable.
 */
export const answerSessionApiFailure =
  (operation: string) =>
  <A, E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, CustomerSessionApiFailure<E>, R> =>
    effect.pipe(
      Effect.catch((failure) => {
        const { answer, codes } = answerFailure(failure);
        const sessionAnswer: CustomerSessionApiFailure<E> =
          answer instanceof CustomerAccountLinkRequired
            ? new CustomerServiceUnavailable()
            : (answer as CustomerSessionApiFailure<E>);
        return logFailedRequest(operation, sessionAnswer._tag, codes).pipe(
          Effect.andThen(Effect.fail(sessionAnswer))
        );
      })
    );

const logFailedRequest = (
  operation: string,
  answer: string,
  codes: Readonly<Record<string, string>>
) =>
  Effect.logWarning("Customer API request failed.").pipe(
    Effect.annotateLogs({ operation, answer, ...codes })
  );

/**
 * Answers unavailable for an operation outcome the client can only retry,
 * logging the operation and the outcome's fixed codes first.
 */
export const answerUnavailable = (
  operation: string,
  codes: Readonly<Record<string, string>>
) =>
  logFailedRequest(operation, "CustomerServiceUnavailable", codes).pipe(
    Effect.andThen(Effect.fail(new CustomerServiceUnavailable()))
  );
