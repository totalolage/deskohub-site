import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { type NexiOrder, NexiService } from "@deskohub/nexi";
import { Deferred, Effect, Fiber, Layer, Result } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../../customer-account";
import { workspaceSavedCardDeletionReconciliation } from "../auth/workspace-deletion-reconciliation";
import { CustomerAccountDeletionService } from "../customer-account-deletion";
import { CustomerAccountLinkRepository } from "../customer-account-link.repository";
import { CustomerDotyposAdapter } from "../customer-dotypos-adapter.service";
import { SavedCardService } from "./saved-card.service";
import { SavedCardContractRepository } from "./saved-card-contract.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();

const makeAccountId = () =>
  customerAccountIdSchema.make(`0199excl-${uniqueId().slice(0, 8)}`);

const insertAuthUser = (accountId: string, email: string) =>
  testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [accountId, email]
  );

const markerTimestamp = (accountId: string) =>
  testDatabase!.pool
    .query(`select deletion_requested_at from auth."user" where id = $1`, [
      accountId,
    ])
    .then((result) => {
      const value: Date | string | null | undefined =
        result.rows[0]?.deletion_requested_at;
      // node-postgres normally decodes timestamptz to Date; a string value
      // (e.g. ::text casts) is already ISO-shaped.
      return value instanceof Date ? value.toISOString() : (value ?? null);
    });

interface SyntheticNexiState {
  /** Order-id keyed HPP gate: enrollment start pauses until released. */
  readonly hppEntered: Deferred.Deferred<void>;
  readonly hppRelease: Deferred.Deferred<void>;
  readonly hppCalls: string[];
}

const makeSyntheticNexiLayer = (state: SyntheticNexiState) =>
  Layer.mock(NexiService, {
    createHostedPaymentPage: (input: { orderId: string }) =>
      Effect.gen(function* () {
        state.hppCalls.push(input.orderId);
        // Signal the test that the enrollment flow passed the activity
        // recheck and is now paused inside the provider call.
        yield* Deferred.succeed(state.hppEntered, undefined);
        yield* Deferred.await(state.hppRelease);
        return {
          orderId: input.orderId,
          hostedPage: "https://hpp.example/verify",
          securityToken: "synthetic-token",
        };
      }),
    getOrder: ({ orderId }: { orderId: string }) =>
      Effect.succeed({
        orderId,
        operations: [],
      } satisfies Pick<NexiOrder, "orderId" | "operations">),
    listCustomerContracts: () => Effect.succeed([]),
    deactivateContract: () => Effect.void,
  } satisfies Partial<NexiService["Service"]>);

const dotyposLayer = Layer.mock(CustomerDotyposAdapter, {
  expireCustomer: () => Effect.void,
} satisfies Partial<CustomerDotyposAdapter["Service"]>);

const makeLayers = (nexiState: SyntheticNexiState) => {
  const dbLayer = testDatabase!.layer;
  const lockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool);
  const linksLayer = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(Layer.mergeAll(dbLayer, lockLayer))
  );
  const repositoryLayer = SavedCardContractRepository.Default.pipe(
    Layer.provide(dbLayer)
  );
  const savedCardsLayer = SavedCardService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        makeSyntheticNexiLayer(nexiState),
        repositoryLayer,
        linksLayer
      )
    )
  );
  const deletionLayer = CustomerAccountDeletionService.Default.pipe(
    Layer.provide(Layer.mergeAll(linksLayer, dotyposLayer))
  );
  return { savedCardsLayer, deletionLayer };
};

describe.skipIf(!testDatabase)(
  "enrollment/deletion exclusion on the real account advisory lock",
  () => {
    test("enrollment-first: the deletion sweep blocks on the gated, later-persisted enrollment and never completes before it", async () => {
      const accountId = makeAccountId();
      await insertAuthUser(accountId, `excl-a-${uniqueId()}@deskohub.test`);
      const hppEntered = Deferred.make<void>();
      const hppRelease = Deferred.make<void>();
      const nexiState: SyntheticNexiState = {
        hppEntered,
        hppRelease,
        hppCalls: [],
      };
      const { savedCardsLayer, deletionLayer } = makeLayers(nexiState);

      const program = Effect.gen(function* () {
        // (1) Enrollment start acquires the real lock, passes the activity
        // recheck, and pauses inside the gated HPP call.
        const enrollmentFiber = yield* Effect.forkChild(
          Effect.flatMap(SavedCardService, (service) =>
            service.startEnrollment(
              { accountId, dotyposCustomerId: "60911" },
              "en-US"
            )
          ).pipe(Effect.provide(savedCardsLayer))
        );

        // Deterministic gate: resolved by the synthetic provider when the
        // flow reaches the HPP call — no sleeps, no polling.
        yield* Deferred.await(hppEntered);

        // (2) The deletion reconciliation runs CONCURRENTLY and must
        // block on the still-held lock. The bounded pause only gives a
        // broken implementation the opportunity to proceed; the ordering
        // proofs are the marker check below and the sweep's final result.
        const sweepFiber = yield* Effect.forkChild(
          workspaceSavedCardDeletionReconciliation(accountId).pipe(
            Effect.provide(Layer.mergeAll(savedCardsLayer, deletionLayer))
          )
        );
        yield* Effect.sleep("150 millis");
        const markerBeforeRelease = yield* Effect.tryPromise(() =>
          markerTimestamp(accountId)
        );
        // The marker must still be absent while the enrollment holds the
        // lock: the sweep cannot even reach its marker write.
        expect(markerBeforeRelease).toBeNull();

        // (3) Release the enrollment; it persists its pending row and
        // finishes, freeing the lock.
        yield* Deferred.succeed(hppRelease, undefined);
        const enrollment = yield* Fiber.join(enrollmentFiber);
        expect(enrollment.status).toBe("redirect");

        const rows = yield* Effect.tryPromise(() =>
          testDatabase!.pool.query(
            `select state from customer_card_enrollments where customer_account_id = $1`,
            [accountId]
          )
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0].state).toBe("pending");
        const persistedAt = Date.now();

        // (4) The sweep — which only now acquires the freed lock — must
        // observe the pending enrollment: its provider order is
        // indeterminate, so deletion stays retryably blocked. If lock
        // exclusion were broken, the sweep would have completed BEFORE
        // the insert (no rows yet) and this fiber would succeed instead.
        const swept = yield* Effect.result(Fiber.join(sweepFiber));
        return { swept, persistedAt };
      });

      const outcome = await Effect.runPromise(program);
      expect(Result.isFailure(outcome.swept)).toBe(true);
      if (Result.isFailure(outcome.swept)) {
        expect(outcome.swept.failure).toMatchObject({ code: "unavailable" });
      }
      // The sweep's marker write landed only after the enrollment row
      // existed: exclusion held, then the sweep processed the row.
      const markerAfterSweep = await markerTimestamp(accountId);
      expect(markerAfterSweep).not.toBeNull();
      expect(Date.now()).toBeGreaterThanOrEqual(outcome.persistedAt);
    }, 20_000);

    test("deletion-first: a durable marker rejects enrollment start with zero provider calls", async () => {
      const accountId = makeAccountId();
      await insertAuthUser(accountId, `excl-b-${uniqueId()}@deskohub.test`);
      const nexiState: SyntheticNexiState = {
        hppEntered: Deferred.make(),
        hppRelease: Deferred.make(),
        hppCalls: [],
      };
      const { savedCardsLayer, deletionLayer } = makeLayers(nexiState);

      await Effect.runPromise(
        Effect.gen(function* () {
          // The full deletion path completes first: marker, sweep (no
          // enrollments), Dotypos expiration — each under the real lock.
          yield* workspaceSavedCardDeletionReconciliation(accountId).pipe(
            Effect.provide(Layer.mergeAll(savedCardsLayer, deletionLayer))
          );
          const markerAfterSweep = yield* Effect.tryPromise(() =>
            markerTimestamp(accountId)
          );
          expect(markerAfterSweep).not.toBeNull();

          // The enrollment start is rejected by the authoritative
          // activity recheck before any provider session is created.
          const rejection = yield* Effect.result(
            Effect.flatMap(SavedCardService, (service) =>
              service.startEnrollment(
                { accountId, dotyposCustomerId: "60911" },
                "en-US"
              )
            ).pipe(Effect.provide(savedCardsLayer))
          );
          expect(Result.isFailure(rejection)).toBe(true);
        }).pipe(Effect.provide(Layer.mergeAll(savedCardsLayer, deletionLayer)))
      );

      expect(nexiState.hppCalls).toEqual([]);
    }, 20_000);
  }
);
