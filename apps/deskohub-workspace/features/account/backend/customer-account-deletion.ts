import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import type { SqlError } from "effect/unstable/sql";
import { ReviewAccounts } from "@/features/review-accounts";
import type { CustomerAccountId } from "../customer-account";
import { CustomerAccountRepository } from "./customer-account.repository";
import {
  type CustomerAccountLinkError,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import {
  type CustomerAvatarProviderError,
  CustomerAvatarService,
  type CustomerAvatarUnavailableError,
} from "./customer-avatar.service";
import {
  CustomerDotyposAdapter,
  type DotyposCustomerError,
} from "./customer-dotypos-adapter.service";

/**
 * A shared app-directory review account can't be deleted: later review rounds
 * sign in with the same credentials.
 */
export class ReviewAccountDeletionRefusedError extends Data.TaggedError(
  "ReviewAccountDeletionRefusedError"
)<Record<never, never>> {
  override readonly message = "A review account can't be deleted.";
}

export type CustomerAccountDeletionError =
  | ReviewAccountDeletionRefusedError
  | CustomerAccountLinkError
  | DotyposCustomerError
  | CustomerAvatarProviderError
  | CustomerAvatarUnavailableError;

export type CustomerAccountDeletionDependencies = {
  readonly isReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<boolean, CustomerAccountLinkError>;
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
  readonly destroyAvatar: (
    accountId: CustomerAccountId
  ) => Effect.Effect<
    void,
    CustomerAvatarProviderError | CustomerAvatarUnavailableError
  >;
  readonly tombstone: (
    accountId: CustomerAccountId,
    deletedAt: Temporal.Instant
  ) => Effect.Effect<void, CustomerAccountLinkError>;
  readonly withAccountLock: <A, E, R>(
    accountId: CustomerAccountId,
    effect: Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | SqlError.SqlError, R>;
};

/**
 * Provider-first account deletion. Persisting the durable marker must survive
 * a later retryable provider failure, so the marker is written in its own
 * transaction under the session-level account lock, never in the same
 * transaction as the provider call. A review account is refused before
 * anything changes; its marker never goes away, so the check needs no lock.
 */
export const expireLinkedDotyposProfile = (
  dependencies: CustomerAccountDeletionDependencies
) =>
  Effect.fn("CustomerAccountDeletion.expireLinkedDotyposProfile")(function* (
    accountId: CustomerAccountId
  ) {
    if (yield* dependencies.isReviewAccount(accountId)) {
      return yield* new ReviewAccountDeletionRefusedError();
    }
    return yield* dependencies
      .withAccountLock(
        accountId,
        Effect.gen(function* () {
          yield* dependencies.markDeletionRequested(accountId, new Date());

          const linkedCustomerId = yield* dependencies.findLink(accountId);
          if (linkedCustomerId) {
            yield* dependencies
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
          }

          // The media asset goes before identity removal: an uncertain
          // provider outcome fails retryably so deletion stays retryable,
          // and a missing asset is idempotent success.
          yield* dependencies.destroyAvatar(accountId);

          // The tombstone goes last, once nothing retryable remains, and
          // before Better Auth removes the identity rows, so reservations
          // the account authored keep their author.
          yield* dependencies.tombstone(accountId, Temporal.Now.instant());
        })
      )
      .pipe(
        Effect.tapError((cause) =>
          Effect.logWarning(
            "Customer account deletion: provider cleanup failed; deletion stays retryable.",
            { code: "account.deletion.retryable", cause }
          )
        )
      );
  });

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
      const accounts = yield* CustomerAccountRepository;
      const dotypos = yield* CustomerDotyposAdapter;
      const avatars = yield* CustomerAvatarService;
      const reviewAccounts = yield* ReviewAccounts;

      const requestDeletion = expireLinkedDotyposProfile({
        isReviewAccount: reviewAccounts.isReviewAccount,
        markDeletionRequested: links.markDeletionRequested,
        findLink: links.find,
        expireCustomer: dotypos.expireCustomer,
        destroyAvatar: avatars.destroy,
        tombstone: accounts.tombstone,
        withAccountLock: links.withAccountLock,
      });

      return { requestDeletion } satisfies ICustomerAccountDeletionService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CustomerAccountLinkRepository.Live,
        CustomerAccountRepository.Live,
        CustomerDotyposAdapter.Live,
        CustomerAvatarService.Live,
        ReviewAccounts.Live
      )
    )
  );
}
