import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import * as PgClient from "@effect/sql-pg/PgClient";
import { EffectCache } from "drizzle-orm/cache/core/cache-effect";
import { EffectLogger, makeWithDefaults } from "drizzle-orm/effect-postgres";
import { Effect, Layer } from "effect";
import { Client, Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { relations } from "@/db/relations";
import { workspaceReservations } from "@/db/schema";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { PaymentLifecycleRepository } from "./payment-lifecycle.repository";
import { paymentLifecycleTestSchemaStatements } from "./payment-lifecycle.repository.test-schema";

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

describe("payment reconciliation real PostgreSQL locking", () => {
  realPostgresTest(
    "fences production admission while an exact claim owns provider lookup",
    async () => {
      if (!realPostgresUrl) return;

      const schema = `payment_reconciliation_${randomUUID().replaceAll("-", "")}`;
      const admin = new Client({ connectionString: realPostgresUrl });
      await admin.connect();
      await admin.query(`create schema "${schema}"`);

      const poolOptions = {
        connectionString: realPostgresUrl,
        max: 1,
        options: `-c search_path=${schema}`,
      };
      const ownerPool = new Pool(poolOptions);
      const contenderPool = new Pool(poolOptions);

      try {
        await runRepository(
          ownerPool,
          Effect.gen(function* () {
            const { db } = yield* WorkspaceDatabase;
            for (const statement of paymentLifecycleTestSchemaStatements) {
              yield* db.execute(statement);
            }
            yield* db.insert(workspaceReservations).values({
              id: "reservation-a",
              checkoutSessionKey: "session-a",
              checkoutAttemptKey: "attempt-a",
              correlationId: "correlation-a",
              dotyposCustomerId: "customer-a",
              dotyposReservationId: "provider-reservation-a",
              reservationState: "held",
              paymentState: "not_started",
              fulfillmentState: "not_started",
              reservationHoldExpiresAt: new Date(Date.now() + 300_000),
            });
          })
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

        let lookupStarted!: () => void;
        const lookupStartedBarrier = new Promise<void>((resolve) => {
          lookupStarted = resolve;
        });
        let releaseLookup!: () => void;
        const lookupReleaseBarrier = new Promise<void>((resolve) => {
          releaseLookup = resolve;
        });
        let providerOrderCount = 1;

        const reconciliation = runRepository(
          ownerPool,
          Effect.gen(function* () {
            const repository = yield* PaymentLifecycleRepository;
            const claim = yield* repository.claimProviderReconciliation({
              id: admitted.attempt.id,
              workspaceReservationId: "reservation-a",
            });
            expect(claim.outcome).toBe("claimed");
            lookupStarted();
            yield* Effect.promise(() => lookupReleaseBarrier);
            return claim;
          })
        );

        await lookupStartedBarrier;
        const competingAdmission = await runRepository(
          contenderPool,
          Effect.gen(function* () {
            const repository = yield* PaymentLifecycleRepository;
            const result = yield* admit(repository, "provider-order-b");
            if (result.outcome === "created") providerOrderCount += 1;
            return result;
          })
        );
        expect(competingAdmission).toEqual({
          outcome: "unavailable",
          reason: "active_attempt",
        });

        releaseLookup();
        await reconciliation;

        const attempts = await admin.query<{ count: string }>(
          `select count(*) from "${schema}".payment_attempts
           where workspace_reservation_id = 'reservation-a'`
        );
        expect(attempts.rows[0]?.count).toBe("1");
        expect(providerOrderCount).toBe(1);
      } finally {
        await Promise.all([ownerPool.end(), contenderPool.end()]);
        await admin.query(`drop schema if exists "${schema}" cascade`);
        await admin.end();
      }
    },
    30_000
  );
});
