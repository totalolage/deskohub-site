import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { CustomerAccountId } from "../customer-account";
import {
  type CustomerAccountLinkError,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import {
  CustomerDotyposAdapter,
  type DotyposCustomerError,
} from "./customer-dotypos-adapter.service";

export type CustomerAccountDeletionError =
  | CustomerAccountLinkError
  | DotyposCustomerError;

export type CustomerAccountDeletionDependencies = {
  readonly markDeletionRequested: (
    accountId: CustomerAccountId,
    requestedAt: Date
  ) => Effect.Effect<void, CustomerAccountLinkError>;
  readonly findLink: (
    accountId: CustomerAccountId
  ) => Effect.Effect<DotyposCustomerId | null, CustomerAccountLinkError>;
  readonly expireCustomer: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<void, DotyposCustomerError>;
  readonly withAccountLock: <A, E, R>(
    accountId: CustomerAccountId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError, R>;
};

/**
 * Provider-first account deletion. Persisting the durable marker must survive
 * a later retryable provider failure, so the marker is written in its own
 * transaction under the session-level account lock, never in the same
 * transaction as the provider call.
 */
export const expireLinkedDotyposProfile = (
  dependencies: CustomerAccountDeletionDependencies
) =>
  Effect.fn("CustomerAccountDeletion.expireLinkedDotyposProfile")(
    (accountId: CustomerAccountId) =>
      dependencies.withAccountLock(
        accountId,
        Effect.gen(function* () {
          yield* dependencies.markDeletionRequested(accountId, new Date());

          const linkedCustomerId = yield* dependencies.findLink(accountId);
          if (!linkedCustomerId) return;

          return yield* dependencies
            .expireCustomer(linkedCustomerId)
            .pipe(
              Effect.catchTag("ExternalAPIError", (error) =>
                error.statusCode === 404
                  ? Effect.logWarning(
                      "Customer account deletion: Dotypos profile already missing.",
                      { code: "dotypos.customer-expiration.missing" }
                    )
                  : Effect.fail(error)
              )
            );
        })
      )
  );

interface ICustomerAccountDeletionService {
  readonly requestDeletion: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, CustomerAccountDeletionError>;
}

export class CustomerAccountDeletionService extends Context.Service<
  CustomerAccountDeletionService,
  ICustomerAccountDeletionService
>()("@deskohub-workspace/account/CustomerAccountDeletionService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const links = yield* CustomerAccountLinkRepository;
      const dotypos = yield* CustomerDotyposAdapter;

      const requestDeletion = expireLinkedDotyposProfile({
        markDeletionRequested: links.markDeletionRequested,
        findLink: links.find,
        expireCustomer: dotypos.expireCustomer,
        withAccountLock: links.withAccountLock,
      });

      return { requestDeletion } satisfies ICustomerAccountDeletionService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountLinkRepository.Live,
        CustomerDotyposAdapter.Live
      )
    )
  );
}
