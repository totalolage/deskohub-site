import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import type { ReferralSignupIntent } from "@/features/referrals/signup-intent.repository";
import { ReviewAccounts } from "@/features/review-accounts";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountUnavailable,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import {
  type CustomerAccountLinkClaim,
  type CustomerAccountLinkError,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import {
  CustomerDotyposAdapter,
  type DotyposCustomerError,
  type ExactEmailCustomerMatch,
} from "./customer-dotypos-adapter.service";

const accessError = (
  reason: CustomerAccountAccessError["reason"],
  linkReason?: CustomerAccountAccessError["linkReason"]
) =>
  linkReason
    ? new CustomerAccountAccessError({ reason, linkReason })
    : new CustomerAccountAccessError({ reason });

/**
 * The signed-in session's identity, or a failure when no one is signed in or
 * the account awaits deletion.
 */
export const requireVerifiedIdentity = (
  user: CustomerAccountSession | null
): Effect.Effect<CustomerAccountSession, CustomerAccountAccessError> => {
  if (!user) return Effect.fail(accessError("unauthenticated"));
  if (user.deletionRequested) {
    return Effect.fail(accessError("link-required", "deletion-requested"));
  }
  return Effect.succeed(user);
};

export type CustomerAccountResolutionDependencies = {
  readonly currentUser: () => Effect.Effect<
    CustomerAccountSession | null,
    CustomerAccountAccessError
  >;
  readonly findLink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, CustomerAccountLinkError>;
  /**
   * Whether the account is an app-directory review account, which never
   * links or creates a Dotypos customer.
   */
  readonly isReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  readonly classify: (
    email: string
  ) => Effect.Effect<ExactEmailCustomerMatch, DotyposCustomerError>;
  readonly claimLink: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId,
    signupReferral?: ReferralSignupIntent
  ) => Effect.Effect<CustomerAccountLinkClaim, CustomerAccountLinkError>;
  readonly reactivate: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<void, DotyposCustomerError>;
  readonly withAccountLock: <A, E, R>(
    accountId: CustomerAccountId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError.SqlError, R>;
};

/**
 * How the current account resolved. `autoLinked` is true only when this
 * resolution itself claimed the link to an existing exact-email Dotypos
 * customer; an existing link, including one created by profile completion,
 * reports false.
 */
export type CustomerAccountLinkResolution = {
  readonly account: LinkedCustomerAccount;
  readonly autoLinked: boolean;
};

/**
 * Resolution steps for a verified identity whose account lock the caller
 * already holds: an existing link wins, then one usable exact-email Dotypos
 * customer is reactivated if expired and claimed. No match fails with
 * `not-found`, which leaves profile creation to the caller; every other
 * outcome is the support state. A signup referral is written with the link
 * only when this claim creates it.
 */
export const resolveCustomerAccountLinkUnderHeldLock = Effect.fn(
  "account.resolveCustomerAccountLinkUnderHeldLock"
)(function* (
  dependencies: Pick<
    CustomerAccountResolutionDependencies,
    "findLink" | "isReviewAccount" | "classify" | "claimLink" | "reactivate"
  >,
  identity: { readonly accountId: CustomerAccountId; readonly email: string },
  signupReferral?: ReferralSignupIntent
) {
  const existingCustomerId = yield* dependencies
    .findLink(identity.accountId)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.read")));
  if (existingCustomerId) {
    return {
      account: {
        accountId: identity.accountId,
        dotyposCustomerId: existingCustomerId,
      },
      autoLinked: false,
    } satisfies CustomerAccountLinkResolution;
  }

  // A review account books in its sandbox, so no lookup ever reaches Dotypos.
  const reviewAccount = yield* dependencies
    .isReviewAccount(identity.accountId)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.read")));
  if (reviewAccount) {
    return yield* customerAccountUnavailable("account.review");
  }

  const match = yield* dependencies
    .classify(identity.email)
    .pipe(
      Effect.mapError(mapCustomerAccountFailure("dotypos.customer-lookup"))
    );
  if (match.kind !== "matched") {
    return yield* accessError("link-required", match.kind);
  }

  if (match.state === "expired") {
    yield* dependencies
      .reactivate(match.customerId)
      .pipe(
        Effect.mapError(
          mapCustomerAccountFailure("dotypos.customer-expiration")
        )
      );
  }

  const claimed = yield* dependencies
    .claimLink(identity.accountId, match.customerId, signupReferral)
    .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.claim")));
  if (claimed.kind === "claimed") {
    return yield* accessError("link-required", "claimed");
  }

  return {
    account: {
      accountId: identity.accountId,
      dotyposCustomerId: claimed.customerId,
    },
    autoLinked: true,
  } satisfies CustomerAccountLinkResolution;
});

export const resolveCustomerAccount = (
  dependencies: CustomerAccountResolutionDependencies
): Effect.Effect<LinkedCustomerAccount, CustomerAccountAccessError> =>
  resolveCustomerAccountLink(dependencies).pipe(
    Effect.map((resolution) => resolution.account)
  );

export const resolveCustomerAccountLink = (
  dependencies: CustomerAccountResolutionDependencies
): Effect.Effect<CustomerAccountLinkResolution, CustomerAccountAccessError> =>
  Effect.gen(function* () {
    const user = yield* dependencies.currentUser();
    const identity = yield* requireVerifiedIdentity(user);

    return yield* dependencies
      .withAccountLock(
        identity.accountId,
        Effect.gen(function* () {
          const lockedUser = yield* dependencies.currentUser();
          if (!lockedUser || lockedUser.accountId !== identity.accountId) {
            return yield* accessError("unauthenticated");
          }
          const lockedIdentity = yield* requireVerifiedIdentity(lockedUser);

          return yield* resolveCustomerAccountLinkUnderHeldLock(
            dependencies,
            lockedIdentity
          );
        })
      )
      .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.lock")));
  });

const resolutionDependencies: Effect.Effect<
  CustomerAccountResolutionDependencies,
  never,
  | CustomerAuthentication
  | CustomerAccountLinkRepository
  | CustomerDotyposAdapter
  | ReviewAccounts
> = Effect.gen(function* () {
  const authentication = yield* CustomerAuthentication;
  const links = yield* CustomerAccountLinkRepository;
  const dotypos = yield* CustomerDotyposAdapter;
  const reviewAccounts = yield* ReviewAccounts;
  return {
    currentUser: () => authentication.currentUser,
    findLink: links.find,
    isReviewAccount: reviewAccounts.isReviewAccount,
    classify: dotypos.classifyExactEmailCustomers,
    claimLink: links.claim,
    reactivate: dotypos.reactivateCustomer,
    withAccountLock: links.withAccountLock,
  };
});

const resolutionDependenciesWith = <E, R>(
  authentication: Layer.Layer<CustomerAuthentication, E, R>
) =>
  Layer.mergeAll(
    authentication,
    CustomerAccountLinkRepository.Live,
    CustomerDotyposAdapter.Live,
    ReviewAccounts.Live
  );

interface ICustomerAccountResolver {
  readonly resolve: Effect.Effect<
    LinkedCustomerAccount,
    CustomerAccountAccessError
  >;
  /**
   * Resolution that also reports whether this visit auto-linked the account,
   * which only the account page acts on.
   */
  readonly resolveLink: Effect.Effect<
    CustomerAccountLinkResolution,
    CustomerAccountAccessError
  >;
}

export class CustomerAccountResolver extends Context.Service<
  CustomerAccountResolver,
  ICustomerAccountResolver
>()("@deskohub-workspace/account/CustomerAccountResolver") {
  static Default = Layer.effect(
    this,
    Effect.map(
      resolutionDependencies,
      (dependencies): ICustomerAccountResolver => ({
        resolve: resolveCustomerAccount(dependencies),
        resolveLink: resolveCustomerAccountLink(dependencies),
      })
    )
  );

  /**
   * The service reading the customer through this authentication, such as
   * an agent's access token instead of the browser session.
   */
  static withAuthentication = <E, R>(
    authentication: Layer.Layer<CustomerAuthentication, E, R>
  ) =>
    this.Default.pipe(
      Layer.provide(resolutionDependenciesWith(authentication))
    );

  static Live = this.withAuthentication(CustomerAuthentication.Default);
}
