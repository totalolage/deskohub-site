import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
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
  readonly classify: (
    email: string
  ) => Effect.Effect<ExactEmailCustomerMatch, DotyposCustomerError>;
  readonly claimLink: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId
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

          const existingCustomerId = yield* dependencies
            .findLink(lockedIdentity.accountId)
            .pipe(
              Effect.mapError(mapCustomerAccountFailure("account-link.read"))
            );
          if (existingCustomerId) {
            return {
              account: {
                accountId: lockedIdentity.accountId,
                dotyposCustomerId: existingCustomerId,
              },
              autoLinked: false,
            };
          }

          const match = yield* dependencies
            .classify(lockedIdentity.email)
            .pipe(
              Effect.mapError(
                mapCustomerAccountFailure("dotypos.customer-lookup")
              )
            );
          if (match.kind === "not-found") {
            return yield* accessError("link-required", "not-found");
          }
          if (match.kind === "ambiguous") {
            return yield* accessError("link-required", "ambiguous");
          }
          if (match.kind === "unusable") {
            return yield* accessError("link-required", "unusable");
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
            .claimLink(lockedIdentity.accountId, match.customerId)
            .pipe(
              Effect.mapError(mapCustomerAccountFailure("account-link.claim"))
            );
          if (claimed.kind === "claimed") {
            return yield* accessError("link-required", "claimed");
          }

          return {
            account: {
              accountId: lockedIdentity.accountId,
              dotyposCustomerId: claimed.customerId,
            },
            autoLinked: true,
          };
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
> = Effect.gen(function* () {
  const authentication = yield* CustomerAuthentication;
  const links = yield* CustomerAccountLinkRepository;
  const dotypos = yield* CustomerDotyposAdapter;
  return {
    currentUser: () => authentication.currentUser,
    findLink: links.find,
    classify: dotypos.classifyExactEmailCustomers,
    claimLink: links.claim,
    reactivate: dotypos.reactivateCustomer,
    withAccountLock: links.withAccountLock,
  };
});

const resolutionDependenciesLive = Layer.mergeAll(
  CustomerAuthentication.Default,
  CustomerAccountLinkRepository.Live,
  CustomerDotyposAdapter.Live
);

interface ICustomerAccountResolver {
  readonly resolve: Effect.Effect<
    LinkedCustomerAccount,
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
      })
    )
  );

  static Live = this.Default.pipe(Layer.provide(resolutionDependenciesLive));
}

/**
 * Live-wired resolution of the current account for the account page, the one
 * place that also needs to know whether this visit auto-linked the account.
 */
export const resolveCurrentCustomerAccount: Effect.Effect<
  CustomerAccountLinkResolution,
  CustomerAccountAccessError
> = Effect.flatMap(resolutionDependencies, resolveCustomerAccountLink).pipe(
  Effect.provide(resolutionDependenciesLive),
  Effect.mapError(mapCustomerAccountFailure("account-link.lock"))
);
