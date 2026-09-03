import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import {
  type CustomerAccountLinkClaim,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import {
  CustomerDotyposAdapter,
  type ExactEmailCustomerMatch,
} from "./customer-dotypos-adapter.service";

const accessError = (
  reason: CustomerAccountAccessError["reason"],
  linkReason?: CustomerAccountAccessError["linkReason"]
) =>
  linkReason
    ? new CustomerAccountAccessError({ reason, linkReason })
    : new CustomerAccountAccessError({ reason });

const requireVerifiedIdentity = (
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
  ) => Effect.Effect<DotyposCustomerId | null, unknown>;
  readonly classify: (
    email: string
  ) => Effect.Effect<ExactEmailCustomerMatch, unknown>;
  readonly claimLink: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerAccountLinkClaim, unknown>;
  readonly reactivate: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<void, unknown>;
  readonly withAccountLock: <A, E, R>(
    accountId: CustomerAccountId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, unknown, R>;
};

export const resolveCustomerAccount = (
  dependencies: CustomerAccountResolutionDependencies
): Effect.Effect<LinkedCustomerAccount, CustomerAccountAccessError> =>
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
              accountId: lockedIdentity.accountId,
              dotyposCustomerId: existingCustomerId,
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

          const claimed = yield* dependencies
            .claimLink(lockedIdentity.accountId, match.customerId)
            .pipe(
              Effect.mapError(mapCustomerAccountFailure("account-link.claim"))
            );
          if (claimed.kind === "claimed") {
            return yield* accessError("link-required", "claimed");
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

          return {
            accountId: lockedIdentity.accountId,
            dotyposCustomerId: match.customerId,
          };
        })
      )
      .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.lock")));
  });

interface ICustomerAccountResolver {
  readonly resolve: () => Effect.Effect<
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
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const links = yield* CustomerAccountLinkRepository;
      const dotypos = yield* CustomerDotyposAdapter;

      const resolve = Effect.fn("CustomerAccountResolver.resolve")(() =>
        resolveCustomerAccount({
          currentUser: () => authentication.currentUser,
          findLink: links.find,
          classify: dotypos.classifyExactEmailCustomers,
          claimLink: links.claim,
          reactivate: dotypos.reactivateCustomer,
          withAccountLock: links.withAccountLock,
        })
      );

      return { resolve } satisfies ICustomerAccountResolver;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAuthentication.Default,
        CustomerAccountLinkRepository.Live,
        CustomerDotyposAdapter.Live
      )
    )
  );
}

export const resolveCurrentCustomerAccount = (): Effect.Effect<
  LinkedCustomerAccount,
  CustomerAccountAccessError
> =>
  Effect.flatMap(CustomerAccountResolver, (resolver) =>
    resolver.resolve()
  ).pipe(
    Effect.provide(CustomerAccountResolver.Live),
    Effect.mapError(mapCustomerAccountFailure("account-link.lock"))
  );
