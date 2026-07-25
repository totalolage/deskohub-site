import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { PaymentVerificationResult } from "@deskohub/nexi";
import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import { EffectLogger, makeWithDefaults } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import { Client, Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { relations } from "@/db/relations";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { applyCommittedWorkspaceMigrations } from "@/shared/testing/workspace-migrations";
import { PaymentLifecycleRepository } from "./payment-lifecycle.repository";

mock.module("server-only", () => ({}));

const realPostgresUrl = process.env.WORKSPACE_REAL_POSTGRES_TEST_URL;
const realPostgresTest = realPostgresUrl ? test : test.skip;

const pricing = {
  fingerprint: "pricing-fingerprint",
  total: { value: 1000, exponent: 2, currency: "CZK" },
  discounts: [],
} as const;

const commitment = makeDiscountCommitment({
  product: { kind: "cowork", tier: "basic" },
  applications: [],
});

const makeDatabaseLayer = (pool: Pool) => {
  const PgClientLive = PgClient.layerFrom(
    PgClient.fromPool({ acquire: Effect.succeed(pool) })
  );
  return Layer.effect(
    WorkspaceDatabase,
    makeWithDefaults({ relations }).pipe(
      Effect.provide(Layer.merge(EffectCache.Default, EffectLogger.layer)),
      Effect.map((db) => WorkspaceDatabase.of({ db }))
    )
  ).pipe(Layer.provide(PgClientLive));
};

const makeRepositoryLayer = (pool: Pool) => {
  const database = makeDatabaseLayer(pool);
  return Layer.merge(
    database,
    PaymentLifecycleRepository.Live.pipe(Layer.provide(database))
  );
};

const runRepository = <A, E>(
  pool: Pool,
  effect: Effect.Effect<A, E, PaymentLifecycleRepository | WorkspaceDatabase>
) =>
  Effect.runPromise(
    Effect.scoped(effect.pipe(Effect.provide(makeRepositoryLayer(pool))))
  );

const admit = (
  repository: typeof PaymentLifecycleRepository.Service,
  providerOrderId: string
) =>
  repository.admitPaymentStart({
    workspaceReservationId: "reservation-a",
    checkoutSessionKey: "session-a",
    providerOrderId,
    acceptedPricing: pricing,
    affirmedPricing: pricing,
    commitment,
    locale: "en-US",
    allowNewAdmission: true,
  });

const makeTestDatabaseUrl = (databaseName: string) => {
  if (!realPostgresUrl) throw new Error("Real PostgreSQL URL is required.");
  const url = new URL(realPostgresUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
};

describe("payment reconciliation real PostgreSQL locking", () => {
  realPostgresTest(
    "fences admission during lookup and fences a replacement from verified late evidence",
    async () => {
      if (!realPostgresUrl) return;

      const databaseName = `payment_reconciliation_${randomUUID().replaceAll("-", "")}`;
      const admin = new Client({ connectionString: realPostgresUrl });
      await admin.connect();
      await admin.query(`create database "${databaseName}"`);

      const testDatabaseUrl = makeTestDatabaseUrl(databaseName);
      const migrationClient = new Client({ connectionString: testDatabaseUrl });
      const ownerPool = new Pool({
        connectionString: testDatabaseUrl,
        max: 2,
      });
      const contenderPool = new Pool({
        connectionString: testDatabaseUrl,
        max: 1,
      });

      try {
        await migrationClient.connect();
        await applyCommittedWorkspaceMigrations(migrationClient);

        await migrationClient.query(
          `insert into workspace_reservations (
             id,
             checkout_session_key,
             checkout_attempt_key,
             correlation_id,
             dotypos_customer_id,
             dotypos_reservation_id,
             customer_access_code,
             reservation_details,
             locale,
             reservation_state,
             payment_state,
             fulfillment_state,
             reservation_hold_expires_at
           ) values (
             'reservation-a',
             'session-a',
             'attempt-a',
             'correlation-a',
             'customer-a',
             'provider-reservation-a',
             uuid_generate_v7()::text,
             '{"kind":"cowork","entryTier":"basic","coffee":false}'::jsonb,
             'en-US',
             'held',
             'not_started',
             'not_started',
             clock_timestamp() + interval '5 minutes'
           )`
        );

        const admitted = await runRepository(
          ownerPool,
          Effect.gen(function* () {
            const repository = yield* PaymentLifecycleRepository;
            return yield* admit(repository, "provider-order-a");
          })
        );
        expect(admitted.outcome).toBe("created");
        if (admitted.outcome !== "created") return;

        await migrationClient.query(
          `update payment_attempts
           set provider_start_lease_expires_at = clock_timestamp() - interval '1 second'
           where id = $1`,
          [admitted.attempt.id]
        );

        let lookupStarted!: () => void;
        const lookupStartedBarrier = new Promise<void>((resolve) => {
          lookupStarted = resolve;
        });
        let releaseLookup!: () => void;
        const lookupReleaseBarrier = new Promise<void>((resolve) => {
          releaseLookup = resolve;
        });
        let providerLookupCount = 0;
        const verifyPaymentOutcome = mock(() =>
          Effect.gen(function* () {
            providerLookupCount += 1;
            if (providerLookupCount > 1) {
              return {
                status: "success",
                provider: {
                  orderId: "provider-order-a",
                  operationId: "late-provider-operation-a",
                  operationType: "CAPTURE",
                  amount: "1000",
                  currency: "CZK",
                  orderStatus: "EXECUTED",
                  captureExecuted: true,
                },
                mismatches: [],
              } satisfies PaymentVerificationResult;
            }
            lookupStarted();
            yield* Effect.promise(() => lookupReleaseBarrier);
            return {
              status: "pending",
              provider: {
                orderId: "provider-order-a",
                operationId: "provider-operation-a",
                operationType: "CAPTURE",
                amount: "1000",
                currency: "CZK",
                orderStatus: "PENDING",
                captureExecuted: false,
              },
              mismatches: [],
            } satisfies PaymentVerificationResult;
          })
        );

        const [
          { NexiService },
          {
            ProviderPaymentFinalizationService,
            ProviderPaymentFinalizationServiceLive,
          },
          { PaymentAttemptRepository },
          { WorkspacePaidFulfillmentService },
          { WorkspaceReservationRepositoryLive },
          { PostHogEventService },
        ] = await Promise.all([
          import("@deskohub/nexi"),
          import("../payment/provider-payment-finalization.service"),
          import("./payment-attempt.repository"),
          import("../fulfillment/paid-fulfillment.service"),
          import(
            "@/features/reservation/backend/workspace-reservation.repository"
          ),
          import("@/shared/backend/analytics/posthog-event.service"),
        ]);

        const ownerDatabase = makeDatabaseLayer(ownerPool);
        const ownerDependencies = Layer.mergeAll(
          ownerDatabase,
          PaymentLifecycleRepository.Live.pipe(Layer.provide(ownerDatabase)),
          PaymentAttemptRepository.Live.pipe(Layer.provide(ownerDatabase)),
          WorkspaceReservationRepositoryLive.pipe(Layer.provide(ownerDatabase)),
          Layer.succeed(NexiService, {
            createHostedPaymentPage: () => Effect.die("must not create HPP"),
            verifyPaymentOutcome,
          }),
          Layer.succeed(WorkspacePaidFulfillmentService, {
            fulfillPaidOrder: () => Effect.die("must not fulfill"),
          }),
          Layer.succeed(PostHogEventService, {
            capture: () => Effect.void,
          })
        );
        const finalizationLayer = ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(ownerDependencies)
        );

        const reconciliation = Effect.gen(function* () {
          const finalization = yield* ProviderPaymentFinalizationService;
          return yield* finalization.finalizePendingProviderPayment({
            orderId: "reservation-a",
            paymentAttemptId: admitted.attempt.id,
          });
        }).pipe(
          Effect.provide(finalizationLayer),
          Effect.scoped,
          Effect.runPromise
        );

        await lookupStartedBarrier;
        const competingAdmission = await runRepository(
          contenderPool,
          Effect.gen(function* () {
            const repository = yield* PaymentLifecycleRepository;
            return yield* admit(repository, "provider-order-b");
          })
        );
        expect(competingAdmission).toEqual({
          outcome: "unavailable",
          reason: "active_attempt",
        });

        releaseLookup();
        expect(await reconciliation).toBe("pending");

        const durableOrders = await migrationClient.query<{
          attempts: string;
          providerOrders: string;
        }>(
          `select count(*) as attempts,
                  count(distinct provider_order_id) as "providerOrders"
           from payment_attempts
           where workspace_reservation_id = $1`,
          ["reservation-a"]
        );
        expect(durableOrders.rows[0]).toEqual({
          attempts: "1",
          providerOrders: "1",
        });
        expect(providerLookupCount).toBe(1);
        expect(verifyPaymentOutcome).toHaveBeenCalledTimes(1);

        await runRepository(
          ownerPool,
          Effect.gen(function* () {
            const repository = yield* PaymentLifecycleRepository;
            yield* repository.markTerminal({
              id: admitted.attempt.id,
              workspaceReservationId: "reservation-a",
              state: "failed",
              failureCode: "nexi_payment_failed",
              providerOperationId: "initial-provider-operation-a",
              providerStatus: "DECLINED",
            });
          })
        );
        const replacement = await runRepository(
          ownerPool,
          Effect.gen(function* () {
            const repository = yield* PaymentLifecycleRepository;
            return yield* admit(repository, "provider-order-b");
          })
        );
        expect(replacement.outcome).toBe("created");
        if (replacement.outcome !== "created") return;

        const lateEvidenceResult = await Effect.gen(function* () {
          const finalization = yield* ProviderPaymentFinalizationService;
          return yield* finalization.finalizePendingProviderPayment({
            orderId: "reservation-a",
            paymentAttemptId: admitted.attempt.id,
          });
        }).pipe(
          Effect.provide(finalizationLayer),
          Effect.scoped,
          Effect.runPromise
        );

        expect(lateEvidenceResult).toBe("manual_review");
        expect(providerLookupCount).toBe(2);
        expect(verifyPaymentOutcome).toHaveBeenCalledTimes(2);
        const fencedReservation = await migrationClient.query<{
          activeAttemptId: string;
          evidenceConflicted: boolean;
          paymentState: string;
        }>(
          `select active_payment_attempt_id as "activeAttemptId",
                  active_payment_evidence_conflicted as "evidenceConflicted",
                  payment_state as "paymentState"
           from workspace_reservations
           where id = $1`,
          ["reservation-a"]
        );
        expect(fencedReservation.rows[0]).toEqual({
          activeAttemptId: replacement.attempt.id,
          evidenceConflicted: true,
          paymentState: "pending",
        });
        const lateConflicts = await migrationClient.query<{
          conflictCode: string;
          paymentAttemptId: string;
        }>(
          `select conflict_code as "conflictCode",
                  payment_attempt_id as "paymentAttemptId"
           from payment_evidence_conflicts
           where payment_attempt_id = $1`,
          [admitted.attempt.id]
        );
        expect(lateConflicts.rows).toEqual([
          {
            conflictCode: "provider_terminal_state",
            paymentAttemptId: admitted.attempt.id,
          },
        ]);
      } finally {
        await Promise.all([ownerPool.end(), contenderPool.end()]);
        await migrationClient.end();
        await admin.query(
          `drop database if exists "${databaseName}" with (force)`
        );
        await admin.end();
      }
    },
    60_000
  );
});
