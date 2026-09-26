import { Effect, Layer } from "effect";
import { CustomerAccountDeletionService } from "@/features/account/backend/customer-account-deletion";
import { SavedCardService } from "@/features/account/backend/saved-card/saved-card.service";
import type { CustomerAccountId } from "../../customer-account";

/**
 * The ordered deletion cleanup for saved-card state, composed so the deletion
 * hook can run it inside Better Auth's beforeDelete:
 *
 * (a) the durable deletion marker is persisted first (under the account
 *     lock), so the account activity guard blocks new enrollment and listing
 *     activity from here on — a concurrent enrollment cannot slip in;
 * (b) saved-card provider state reconciles and deactivates: non-confirmed
 *     enrollments reconcile (an in-flight, provider-non-terminal verification
 *     throws retryably and keeps the deletion blocked), then every provider
 *     CARD contract deactivates with a final empty provider re-read;
 * (c) any retryable Nexi failure propagates, so Better Auth rejects identity
 *     removal, the marker stays durable, and a later retry resumes (each step
 *     is idempotent and already-deactivated contracts vanish from the
 *     provider list).
 *
 * The Dotypos expiration itself stays in the deletion service's
 * `requestDeletion`, which re-persists the marker idempotently under the lock
 * and keeps its existing behavior.
 */
export const workspaceSavedCardDeletionReconciliation = Effect.fn(
  "workspace.deletion.savedCardReconciliation"
)(function* (accountId: CustomerAccountId) {
  yield* Effect.flatMap(CustomerAccountDeletionService, (service) =>
    service.markDeletionRequested(accountId)
  );
  yield* Effect.flatMap(SavedCardService, (service) =>
    service.deactivateAllForDeletion(accountId)
  );
  // The Dotypos expiration keeps its existing behavior unchanged; it
  // re-persists the marker idempotently under the account lock.
  yield* Effect.flatMap(CustomerAccountDeletionService, (service) =>
    service.requestDeletion(accountId)
  );
});

/**
 * The reconciliation effect with its live dependencies provided. Exposed as a
 * factory so the deletion hook can run it through `runWorkspaceEffect` and
 * tests can exercise the ordering with mock layers.
 */
export const makeWorkspaceSavedCardDeletionReconciliation = (
  accountId: CustomerAccountId
): Effect.Effect<void, unknown, never> =>
  workspaceSavedCardDeletionReconciliation(accountId).pipe(
    Effect.provide(
      Layer.mergeAll(CustomerAccountDeletionService.Live, SavedCardService.Live)
    )
  ) as Effect.Effect<void, unknown, never>;
