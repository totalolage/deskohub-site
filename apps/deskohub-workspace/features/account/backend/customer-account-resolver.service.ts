import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  CustomerAccountAccessError,
  type CustomerAccountId,
  customerAccountIdSchema,
  type LinkedCustomerAccount,
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
    Schema.decodeUnknownOption(customerAccountIdSchema)(user.id)
  );
  const email = Option.getOrUndefined(
    Schema.decodeUnknownOption(reservationCustomerEmailSchema)(user.email)
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
  readonly currentUser: Effect.Effect<
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
};

export const resolveCustomerAccount = (
  dependencies: CustomerAccountResolutionDependencies
): Effect.Effect<LinkedCustomerAccount, CustomerAccountAccessError> =>
  Effect.gen(function* () {
    const user = yield* dependencies.currentUser;
    if (!user) return yield* Effect.fail(accessError("unauthenticated"));
    const identity = yield* decodeSessionIdentity(user);

    const existingCustomerId = yield* dependencies
      .findLink(identity.accountId)
      .pipe(Effect.mapError(() => accessError("unavailable")));
    if (existingCustomerId) {
      return {
        accountId: identity.accountId,
        dotyposCustomerId: existingCustomerId,
      };
    }

    const match = yield* dependencies
      .findCustomer(identity.email, identity.name)
      .pipe(Effect.mapError(() => accessError("unavailable")));
    if (match.kind === "not-found") {
      return yield* Effect.fail(accessError("link-required", "not-found"));
    }
    if (match.kind === "ambiguous") {
      return yield* Effect.fail(accessError("link-required", "ambiguous"));
    }

    const claimed = yield* dependencies
      .claimLink(identity.accountId, match.customerId)
      .pipe(Effect.mapError(() => accessError("unavailable")));
    if (claimed.kind === "claimed") {
      return yield* Effect.fail(accessError("link-required", "claimed"));
    }
    return {
      accountId: identity.accountId,
      dotyposCustomerId: claimed.customerId,
    };
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
          currentUser: authentication.currentUser,
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
    Effect.mapError((error) =>
      error instanceof CustomerAccountAccessError
        ? error
        : accessError("unavailable")
    )
  );
