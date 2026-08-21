import "@/shared/polyfills/temporal";

import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { NexiCorrelationIdSchema, NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { Pool } from "pg";
import { WorkspaceDatabase } from "@/db/database.service";
import { type DatabaseClient, makeDatabaseClient } from "@/db/database-client";
import { orders, paymentAttempts } from "@/db/schema";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { orderIdSchema } from "@/features/order";
import type { IPaymentLifecycleRepository } from "./payment-lifecycle.repository";

mock.module("server-only", () => ({}));

const { PaymentLifecycleRepository } = await import(
  "./payment-lifecycle.repository"
);

const databaseTestsEnabled =
  process.env.WORKSPACE_ORDER_DATABASE_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);
const pool = databaseTestsEnabled
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 4 })
  : undefined;
let database: DatabaseClient;
let repository: IPaymentLifecycleRepository;

const seedReplacedAttempt = Effect.fn(
  "PaymentLifecycleRepositoryDatabaseTest.seedReplacedAttempt"
)(function* () {
  const suffix = crypto.randomUUID();
  const orderId = orderIdSchema.make(`goods-payment-${suffix}`);
  const firstAttemptId = paymentAttemptIdSchema.make(`attempt-a-${suffix}`);
  const replacementAttemptId = paymentAttemptIdSchema.make(
    `attempt-b-${suffix}`
  );
  const issuedAt = Temporal.Instant.from("2026-08-16T20:00:00Z");

  yield* database.transaction((tx) =>
    Effect.gen(function* () {
      yield* tx.insert(orders).values({
        id: orderId,
        kind: "goods",
        correlationId: NexiCorrelationIdSchema.make(crypto.randomUUID()),
        dotyposCustomerId: DotyposCustomerIdSchema.make(`customer-${suffix}`),
        paymentState: "expired",
        fulfillmentState: "fulfilled",
        fulfilledAt: issuedAt,
        createdAt: issuedAt,
        updatedAt: issuedAt,
      });
      yield* tx.insert(paymentAttempts).values([
        {
          id: firstAttemptId,
          orderId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`provider-a-${suffix}`),
          state: "expired",
          failureCode: "provider_expired",
          amountValue: 12_500,
          amountExponent: 2,
          currency: "CZK",
          createdAt: issuedAt,
          updatedAt: issuedAt,
        },
        {
          id: replacementAttemptId,
          orderId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`provider-b-${suffix}`),
          state: "pending",
          amountValue: 12_500,
          amountExponent: 2,
          currency: "CZK",
          createdAt: issuedAt,
          updatedAt: issuedAt,
        },
      ]);
      yield* tx
        .update(orders)
        .set({
          activePaymentAttemptId: replacementAttemptId,
          paymentState: "pending",
        })
        .where(eq(orders.id, orderId));
    })
  );

  return { firstAttemptId, orderId, replacementAttemptId };
});

describe.skipIf(!databaseTestsEnabled)(
  "goods superseded payment database reconciliation",
  () => {
    beforeAll(async () => {
      database = await Effect.runPromise(makeDatabaseClient(pool!));
      repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* PaymentLifecycleRepository;
        }).pipe(
          Effect.provide(
            PaymentLifecycleRepository.Default.pipe(
              Layer.provide(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.of({ db: database })
                )
              )
            )
          )
        )
      );
    });

    afterAll(async () => {
      await pool?.end();
    });

    test("records A late success, retires B, and requires a refund if B later succeeds", async () => {
      const fixture = await Effect.runPromise(seedReplacedAttempt());
      const firstPaidAt = Temporal.Instant.from("2026-08-16T21:00:00Z");
      const replacementPaidAt = Temporal.Instant.from("2026-08-16T21:01:00Z");

      const first = await Effect.runPromise(
        repository.markPaid({
          id: fixture.firstAttemptId,
          orderId: fixture.orderId,
          paidAt: firstPaidAt,
        })
      );
      expect(first).toMatchObject({
        changed: true,
        attempt: { refundState: "not_required", state: "paid" },
      });

      const [afterFirstOrder] = await Effect.runPromise(
        database.select().from(orders).where(eq(orders.id, fixture.orderId))
      );
      const [retiredReplacement] = await Effect.runPromise(
        database
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, fixture.replacementAttemptId))
      );
      expect(afterFirstOrder).toMatchObject({
        activePaymentAttemptId: fixture.firstAttemptId,
        paymentState: "paid",
      });
      expect(retiredReplacement).toMatchObject({
        state: "expired",
        failureCode: "superseded_by_paid_attempt",
      });

      const replacement = await Effect.runPromise(
        repository.markPaid({
          id: fixture.replacementAttemptId,
          orderId: fixture.orderId,
          paidAt: replacementPaidAt,
        })
      );
      expect(replacement).toMatchObject({
        changed: false,
        attempt: { refundState: "required", state: "paid" },
      });

      const [settledOrder] = await Effect.runPromise(
        database.select().from(orders).where(eq(orders.id, fixture.orderId))
      );
      expect(settledOrder).toMatchObject({
        activePaymentAttemptId: fixture.firstAttemptId,
        paymentState: "paid",
      });
      expect(Temporal.Instant.compare(settledOrder!.paidAt!, firstPaidAt)).toBe(
        0
      );
    });

    test("serializes concurrent A and B success so exactly one requires a refund", async () => {
      const fixture = await Effect.runPromise(seedReplacedAttempt());
      const paidAt = Temporal.Instant.from("2026-08-16T21:05:00Z");

      const results = await Effect.runPromise(
        Effect.all(
          [fixture.firstAttemptId, fixture.replacementAttemptId].map((id) =>
            repository.markPaid({ id, orderId: fixture.orderId, paidAt })
          ),
          { concurrency: "unbounded" }
        )
      );
      const [settledOrder] = await Effect.runPromise(
        database.select().from(orders).where(eq(orders.id, fixture.orderId))
      );
      const attempts = await Effect.runPromise(
        database
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.orderId, fixture.orderId))
      );

      expect(results.filter(({ changed }) => changed)).toHaveLength(1);
      expect(
        attempts.filter(({ refundState }) => refundState === "required")
      ).toHaveLength(1);
      expect(attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: settledOrder!.activePaymentAttemptId,
            refundState: "not_required",
            state: "paid",
          }),
        ])
      );
    });
  }
);
