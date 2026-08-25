import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
  type LinkedCustomerAccount,
  mapCustomerAccountFailure,
} from "../customer-account";
import {
  type CustomerAccountLinkClaim,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import {
  CustomerAuthentication,
  type CustomerAuthUser,
} from "./customer-authentication.service";

interface ICustomerAccountResolver {
  readonly resolve: () => Effect.Effect<
    LinkedCustomerAccount,
    CustomerAccountAccessError
  >;
}

const accessError = (
  reason: CustomerAccountAccessError["reason"],
  linkReason?: CustomerAccountAccessError["linkReason"]
) =>
  linkReason
    ? new CustomerAccountAccessError({ reason, linkReason })
    : new CustomerAccountAccessError({ reason });

const decodeSessionIdentity = (user: CustomerAuthUser) => {
  const accountId = Option.getOrUndefined(
    Schema.decodeOption(customerAccountIdSchema)(user.id)
  );
  const email = Option.getOrUndefined(
    Schema.decodeOption(reservationCustomerEmailSchema)(user.email)
  );
  if (!accountId || !email) {
    return Effect.fail(accessError("unauthenticated"));
  }
  if (user.emailVerified !== true) {
    return Effect.fail(accessError("unverified-email"));
  }
  return Effect.succeed({
    accountId,
    email,
    name: user.name,
  });
};

type CustomerLookup =
  | { readonly kind: "matched"; readonly customerId: DotyposCustomerId }
  | { readonly kind: "not-found" }
  | { readonly kind: "ambiguous" };

export type CustomerAccountResolutionDependencies = {
  readonly currentUser: () => Effect.Effect<
    CustomerAuthUser | null,
    CustomerAccountAccessError
  >;
  readonly findLink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, unknown>;
  readonly findCustomer: (
    email: string,
    name: string
  ) => Effect.Effect<CustomerLookup, unknown>;
  readonly claimLink: (
    accountId: CustomerAccountId,
    customerId: DotyposCustomerId
  ) => Effect.Effect<CustomerAccountLinkClaim, unknown>;
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
    if (!user) return yield* accessError("unauthenticated");
    const identity = yield* decodeSessionIdentity(user);

    return yield* dependencies
      .withAccountLock(
        identity.accountId,
        Effect.gen(function* () {
          const lockedUser = yield* dependencies.currentUser();
          if (!lockedUser) {
            return yield* accessError("unauthenticated");
          }
          const lockedIdentity = yield* decodeSessionIdentity(lockedUser);
          if (lockedIdentity.accountId !== identity.accountId) {
            return yield* accessError("unauthenticated");
          }

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
            .findCustomer(lockedIdentity.email, lockedIdentity.name)
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
          return {
            accountId: lockedIdentity.accountId,
            dotyposCustomerId: claimed.customerId,
          };
        })
      )
      .pipe(Effect.mapError(mapCustomerAccountFailure("account-link.lock")));
  });

export class CustomerAccountResolver extends Context.Service<
  CustomerAccountResolver,
  ICustomerAccountResolver
>()("@deskohub-workspace/account/CustomerAccountResolver") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const authentication = yield* CustomerAuthentication;
      const links = yield* CustomerAccountLinkRepository;
      const dotypos = yield* DotyposService;

      const resolve = Effect.fn("CustomerAccountResolver.resolve")(() =>
        resolveCustomerAccount({
          currentUser: () => authentication.currentUser,
          findLink: links.find,
          findCustomer: (email, name) =>
            dotypos
              .findCustomer(
                { email, firstName: name },
                { lookupFields: ["email"] }
              )
              .pipe(
                Effect.map((match): CustomerLookup => {
                  if (match._tag === "NotFound") return { kind: "not-found" };
                  if (match._tag === "Ambiguous" || !match.customer.id) {
                    return { kind: "ambiguous" };
                  }
                  return { kind: "matched", customerId: match.customer.id };
                })
              ),
          claimLink: links.claim,
          withAccountLock: links.withAccountLock,
        })
      );

      return { resolve } satisfies ICustomerAccountResolver;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(CustomerAuthentication.Default),
    Layer.provide(CustomerAccountLinkRepository.Live),
    Layer.provide(WorkspaceDotyposLayer)
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
