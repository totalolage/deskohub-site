import "@/shared/testing/workspace-test-env";

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiWebhookEventIdSchema } from "@deskohub/nexi";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import {
  latePaymentRecoveries,
  orders,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import { checkoutAttemptKeySchema } from "@/features/checkout/checkout-identifiers";
import { ensureReservationOrder } from "@/features/order/backend/reservation-order";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type ILatePaymentRecoveryRepository,
  LatePaymentRecoveryRepository,
} from "./late-payment-recovery.repository";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!postgresDatabase)(
  "LatePaymentRecoveryRepository order mirror on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    let repository: ILatePaymentRecoveryRepository;
    const fixtureReservationIds: WorkspaceReservationId[] = [];

    beforeAll(async () => {
      repository = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* LatePaymentRecoveryRepository;
        }).pipe(
          Effect.provide(
            LatePaymentRecoveryRepository.Default.pipe(
              Layer.provide(postgres.layer)
            )
          )
        )
      );
    });

    /**
     * Old-writer-shaped reservation: a late payment failed, the provider later
     * confirmed the money, and the order mirror already exists from the
     * reservation create path (production precondition).
     */
    const insertLatePaymentFixture = async (
      options: { readonly legacyAfterBackfill?: boolean } = {}
    ): Promise<{
      id: WorkspaceReservationId;
      attemptId: string;
    }> => {
      const id = workspaceReservationIdSchema.make(crypto.randomUUID());
      const dotyposReservationId = DotyposReservationIdSchema.make(
        `dotypos-reservation-${crypto.randomUUID()}`
      );
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `attempt-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${crypto.randomUUID()}`
          ),
          dotyposReservationId,
          reservationState: "held",
          paymentState: "failed",
          fulfillmentState: "not_started",
          failureCode: "provider_declined",
          reservationDetails: {
            kind: "cowork",
            entryTier: "basic",
            coffee: false,
          },
          locale: "en-US",
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2099-01-01T00:00:00Z"
          ),
        })
      );
      if (!options.legacyAfterBackfill) {
        // Production precondition: the mirrored order exists (from the create
        // path or the migration backfill) before any attempt is written.
        await Effect.runPromise(
          postgres.db.transaction((tx) =>
            Effect.gen(function* () {
              const [reservation] = yield* tx
                .select()
                .from(workspaceReservations)
                .where(eq(workspaceReservations.id, id))
                .limit(1);
              if (!reservation) return yield* Effect.die("fixture missing");
              yield* ensureReservationOrder({ tx, reservation });
            })
          )
        );
      }
      const [attempt] = await Effect.runPromise(
        postgres.db
          .insert(paymentAttempts)
          .values({
            ...(!options.legacyAfterBackfill && { orderId: id }),
            workspaceReservationId: id,
            provider: "nexi",
            providerOrderId: `order-${crypto.randomUUID()}` as never,
            state: "failed",
            failureCode: "provider_declined",
            amountValue: 35_000,
            amountExponent: 2,
            currency: "CZK",
          })
          .returning()
      );
      await Effect.runPromise(
        postgres.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: attempt!.id })
          .where(eq(workspaceReservations.id, id))
      );
      if (options.legacyAfterBackfill) {
        await Effect.runPromise(
          postgres.db.insert(latePaymentRecoveries).values({
            paymentAttemptId: attempt!.id,
            workspaceReservationId: id,
            webhookEventId: NexiWebhookEventIdSchema.make(
              `event-${crypto.randomUUID()}`
            ),
            providerStatus: "APPROVED",
            state: "pending",
            originalDotyposReservationId: dotyposReservationId,
            verifiedPaidAt: Temporal.Now.instant(),
          })
        );
      }
      fixtureReservationIds.push(id);
      return { id, attemptId: attempt!.id };
    };

    afterEach(async () => {
      if (fixtureReservationIds.length === 0) return;
      const ids = [...fixtureReservationIds];
      fixtureReservationIds.length = 0;
      const client = await postgres.pool.connect();
      try {
        await client.query(
          "delete from late_payment_recoveries where workspace_reservation_id = any($1)",
          [ids]
        );
        await client.query(
          "update orders set active_payment_attempt_id = null where id = any($1)",
          [ids]
        );
        await client.query("delete from orders where id = any($1)", [ids]);
        await client.query(
          "delete from workspace_reservations where id = any($1)",
          [ids]
        );
      } finally {
        client.release();
      }
    });

    const loadOrder = async (id: WorkspaceReservationId) => {
      const rows = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id))
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    };

    test("settling a recovered late payment mirrors paid with the verified paidAt", async () => {
      const { id, attemptId } = await insertLatePaymentFixture();
      const verifiedPaidAt = Temporal.Now.instant();

      await Effect.runPromise(
        repository.start({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          webhookEventId: NexiWebhookEventIdSchema.make(
            `event-${crypto.randomUUID()}`
          ),
          providerStatus: "APPROVED",
          verifiedPaidAt,
        })
      );
      const claimed = await Effect.runPromise(
        repository.claim({
          paymentAttemptId: attemptId as never,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );
      expect(claimed?.state).toBe("processing");

      await Effect.runPromise(
        repository.completeUsingOriginalReservation({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );

      const order = await loadOrder(id);
      expect(order.paymentState).toBe("paid");
      // The mirror keeps the verified provider paidAt, not the settle time.
      expect(
        Number(order.paidAt!.epochNanoseconds - verifiedPaidAt.epochNanoseconds)
      ).toBeLessThan(1_000);
      expect(order.fulfillmentState).toBe("not_started");

      const attempts = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, id))
      );
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.state).toBe("paid");
      expect(attempts[0]!.orderId).toBe(id);
    });

    test("requiring a refund pays the attempt, flags the refund, and keeps the mirror paid", async () => {
      const { id, attemptId } = await insertLatePaymentFixture();

      await Effect.runPromise(
        repository.start({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          webhookEventId: NexiWebhookEventIdSchema.make(
            `event-${crypto.randomUUID()}`
          ),
          providerStatus: "APPROVED",
          verifiedPaidAt: Temporal.Now.instant(),
        })
      );
      await Effect.runPromise(
        repository.claim({
          paymentAttemptId: attemptId as never,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );
      // The service layer carries the operator-facing failure code through
      // the settlement input (see LatePaymentRecoveryService.settleRefund).
      const refundInput = {
        paymentAttemptId: attemptId,
        workspaceReservationId: id,
        failureCode: "late_payment_recovery_unavailable",
        completedAt: Temporal.Now.instant(),
      };
      await Effect.runPromise(
        repository.requireRefund(
          refundInput as Parameters<
            ILatePaymentRecoveryRepository["requireRefund"]
          >[0]
        )
      );

      // The provider confirmed the money, so the mirror is paid even though
      // the booking must be refunded; the refund flag stays on the attempt.
      const order = await loadOrder(id);
      expect(order.paymentState).toBe("paid");

      const attempts = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, id))
      );
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.state).toBe("paid");
      expect(attempts[0]!.refundState).toBe("required");
    });

    test("settlement is idempotent on the recovery state and never duplicates orders", async () => {
      const { id, attemptId } = await insertLatePaymentFixture();
      const verifiedPaidAt = Temporal.Now.instant();

      await Effect.runPromise(
        repository.start({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          webhookEventId: NexiWebhookEventIdSchema.make(
            `event-${crypto.randomUUID()}`
          ),
          verifiedPaidAt,
        })
      );
      await Effect.runPromise(
        repository.claim({
          paymentAttemptId: attemptId as never,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );
      await Effect.runPromise(
        repository.completeUsingOriginalReservation({
          paymentAttemptId: attemptId as never,
          workspaceReservationId: id,
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );

      const orderRows = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id))
      );
      expect(orderRows).toHaveLength(1);
      expect(orderRows[0]!.paymentState).toBe("paid");

      const attemptRows = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(inArray(paymentAttempts.workspaceReservationId, [id]))
      );
      expect(attemptRows).toHaveLength(1);
    });

    test("resuming a post-backfill old recovery persists attempt order linkage", async () => {
      const { id, attemptId } = await insertLatePaymentFixture({
        legacyAfterBackfill: true,
      });
      const startInput = {
        paymentAttemptId: attemptId as never,
        workspaceReservationId: id,
        webhookEventId: NexiWebhookEventIdSchema.make(
          `event-${crypto.randomUUID()}`
        ),
        providerStatus: "APPROVED",
        verifiedPaidAt: Temporal.Now.instant(),
      };

      const resumed = await Effect.runPromise(repository.start(startInput));
      expect(resumed.state).toBe("pending");

      const [linkedOnResume] = await Effect.runPromise(
        postgres.db
          .select({ orderId: paymentAttempts.orderId })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, attemptId as never))
      );
      expect(linkedOnResume!.orderId).toBe(id);

      const claimed = await Effect.runPromise(
        repository.claim({
          paymentAttemptId: attemptId as never,
          staleProcessingBefore: Temporal.Now.instant(),
        })
      );
      expect(claimed?.state).toBe("processing");

      const completedAt = Temporal.Now.instant();
      const completeInput = {
        paymentAttemptId: attemptId as never,
        workspaceReservationId: id,
        reservationState: "confirmed" as const,
        completedAt,
      };
      await Effect.runPromise(
        repository.completeUsingOriginalReservation(completeInput)
      );

      const orderRows = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id))
      );
      expect(orderRows).toHaveLength(1);
      expect(orderRows[0]!.paymentState).toBe("paid");

      // Replay both public recovery entry points after restoring the old
      // missing-link state. The assertion reads payment_attempts.order_id
      // directly; it cannot be satisfied by a projected reservation ID.
      await postgres.pool.query(
        "update payment_attempts set order_id = null where id = $1",
        [attemptId]
      );
      const replayedRecovery = await Effect.runPromise(
        repository.start(startInput)
      );
      expect(replayedRecovery.state).toBe("recovered");

      const [linkedOnResumeReplay] = await Effect.runPromise(
        postgres.db
          .select({ orderId: paymentAttempts.orderId })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, attemptId as never))
      );
      expect(linkedOnResumeReplay!.orderId).toBe(id);

      await postgres.pool.query(
        "update payment_attempts set order_id = null where id = $1",
        [attemptId]
      );
      await Effect.runPromise(
        repository.completeUsingOriginalReservation(completeInput)
      );

      const attempts = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.workspaceReservationId, id))
      );
      expect(attempts).toHaveLength(1);
      expect(attempts[0]!.state).toBe("paid");
      expect(attempts[0]!.orderId).toBe(id);

      const ordersForReservation = await Effect.runPromise(
        postgres.db.select().from(orders).where(eq(orders.id, id))
      );
      expect(ordersForReservation).toHaveLength(1);
    });
  }
);
