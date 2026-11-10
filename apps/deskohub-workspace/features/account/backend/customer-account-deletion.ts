import type { DotyposCustomer, DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer, Option } from "effect";
import { ReviewAccounts } from "@/features/review-accounts";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import type {
  CustomerAccountAccessError,
  CustomerAccountId,
} from "../customer-account";
import { AnalyticsPersonAnonymisation } from "./analytics-person-anonymisation";
import { CustomerAccountRepository } from "./customer-account.repository";
import {
  type CustomerAccountLinkError,
  CustomerAccountLinkRepository,
} from "./customer-account-link.repository";
import { CustomerAccountSections } from "./customer-account-sections";
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
class ReviewAccountDeletionRefusedError extends Data.TaggedError(
  "ReviewAccountDeletionRefusedError"
)<Record<never, never>> {
  override readonly message = "A review account can't be deleted.";
}

type CustomerAccountDeletionError =
  | ReviewAccountDeletionRefusedError
  | CustomerAccountAccessError
  | CustomerAccountLinkError
  | DotyposCustomerError
  | CustomerAvatarProviderError
  | CustomerAvatarUnavailableError;

/**
 * The fixed, low-cardinality fields a deletion that stays retryable logs.
 * The failure itself stays out of the log: its message and cause can carry
 * raw database or provider output.
 */
const retryableDeletionLogFields = (
  failure: CustomerAccountDeletionError
): Readonly<Record<string, string>> =>
  failure._tag === "CustomerAccountAccessError"
    ? {
        failure: failure._tag,
        reason: failure.reason,
        ...(failure.cause && { failureCode: failure.cause.code }),
      }
    : { failure: failure._tag };

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
  /** None means the Dotypos customer is already missing. */
  readonly expireCustomer: (
    customerId: DotyposCustomerId
  ) => Effect.Effect<Option.Option<DotyposCustomer>, DotyposCustomerError>;
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
  readonly withActiveAccount: CustomerAccountSections["Service"]["withActiveAccount"];
  /** Schedules deletion of the account's PostHog person; never fails. */
  readonly anonymiseAnalyticsPerson: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void>;
};

/**
 * Provider-first account deletion. Persisting the durable marker must survive
 * a later retryable provider failure, so the marker is written in its own
 * transaction inside the account's section, never in the same transaction as
 * the provider call. The section only requires the account to exist, so a
 * retry runs with the marker already set; an account that is gone fails
 * `unauthenticated` before anything changes, and a lock that can't be taken
 * fails `unavailable`, both retryable to the caller. A review account is
 * refused before anything changes; its marker never goes away, so the check
 * needs no lock.
 * Once the account is tombstoned, the deletion of its PostHog person is
 * requested; that request never fails the deletion.
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
    yield* dependencies
      .withActiveAccount(
        accountId,
        Effect.gen(function* () {
          yield* dependencies.markDeletionRequested(accountId, new Date());

          const linkedCustomerId = yield* dependencies.findLink(accountId);
          if (linkedCustomerId) {
            yield* dependencies.expireCustomer(linkedCustomerId).pipe(
              Effect.tap(
                Option.match({
                  onNone: () =>
                    Effect.logWarning(
                      "Customer account deletion: Dotypos profile already missing.",
                      { code: "dotypos.customer-expiration.missing" }
                    ),
                  onSome: () => Effect.void,
                })
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
        }),
        { recheck: "present" }
      )
      .pipe(
        Effect.tapError((failure) =>
          Effect.logWarning(
            "Customer account deletion did not complete; deletion stays retryable.",
            {
              code: "account.deletion.retryable",
              ...retryableDeletionLogFields(failure),
            }
          )
        )
      );

    // Only a tombstoned account loses its PostHog person. The deletion runs
    // after the response and never fails, so it can't undo the tombstone by
    // keeping Better Auth from removing the identity rows.
    // Its cause stays out of the log, which must carry no identifiers.
    yield* Effect.suspend(() =>
      dependencies.anonymiseAnalyticsPerson(accountId)
    ).pipe(
      catchRecoverableCause(() =>
        Effect.logWarning(
          "Customer account deletion: PostHog person anonymisation not scheduled.",
          { code: "account.deletion.analytics-person-not-scheduled" }
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
      const analyticsPersons = yield* AnalyticsPersonAnonymisation;
      const sections = yield* CustomerAccountSections;

      const requestDeletion = expireLinkedDotyposProfile({
        isReviewAccount: reviewAccounts.isReviewAccount,
        markDeletionRequested: links.markDeletionRequested,
        findLink: links.find,
        expireCustomer: dotypos.expireCustomer,
        destroyAvatar: avatars.destroy,
        tombstone: accounts.tombstone,
        withActiveAccount: sections.withActiveAccount,
        anonymiseAnalyticsPerson: analyticsPersons.anonymiseDeletedAccount,
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
        ReviewAccounts.Live,
        AnalyticsPersonAnonymisation.Live,
        CustomerAccountSections.Live
      )
    )
  );
}
