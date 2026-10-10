import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentRefundRepository } from "./payment-refund.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentRefundRepository on disposable Postgres",
  () => {
    const postgres = testDatabase;
    if (!postgres) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await postgres.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await postgres.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const run = <A, E>(
      operation: (
        repository: typeof PaymentRefundRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* PaymentRefundRepository);
        }).pipe(
          Effect.provide(PaymentRefundRepository.Default),
          Effect.provide(postgres.layer)
        )
      );

    /** Inserts a synthetic cancelled checkout with one Nexi attempt. */
    const insertCheckout = async (input: {
      readonly attemptState: "paid" | "expired";
      readonly refundState: "not_required" | "required";
    }) => {
      const id = crypto.randomUUID();
      const reservationId = workspaceReservationIdSchema.make(
        `refund-reservation-${id}`
      );
      const paymentAttemptId = paymentAttemptIdSchema.make(
        `refund-attempt-${id}`
      );
      reservationIds.push(reservationId);
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id: reservationId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId: DotyposCustomerIdSchema.make(`customer-${id}`),
          dotyposReservationId: DotyposReservationIdSchema.make(
            `booking-${id}`
          ),
          reservationState: "cancelled",
          paymentState: input.attemptState,
          ...(input.attemptState === "paid" && {
            paidAt: Temporal.Now.instant(),
          }),
          fulfillmentState: "not_started",
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
          locale: "en-US",
        })
      );
      await Effect.runPromise(
        postgres.db.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
          state: input.attemptState,
          ...(input.attemptState === "expired" && {
            failureCode: "payment_abandoned_after_provider_cutoff",
          }),
          refundState: input.refundState,
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
        })
      );
      return paymentAttemptId;
    };

    const readAttempt = async (paymentAttemptId: PaymentAttemptId) => {
      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, paymentAttemptId))
      );
      return attempt;
    };

    const record = (
      paymentAttemptId: PaymentAttemptId,
      refundedAmountValue: number,
      refundedAt = Temporal.Instant.from("2026-10-05T08:30:00Z")
    ) =>
      run((repository) =>
        repository.recordRefund({
          id: paymentAttemptId,
          refundedAmountValue,
          refundedAt,
          recordedAt: Temporal.Now.instant(),
        })
      );

    test("lists only paid attempts that still need a refund", async () => {
      const awaiting = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });
      const settled = await insertCheckout({
        attemptState: "paid",
        refundState: "not_required",
      });
      const refunded = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });
      expect(await record(refunded, 29_000)).toBe("recorded");

      const candidates = await run((repository) =>
        repository.claimAwaitingRefund({
          limit: 1_000,
          checkedAt: Temporal.Now.instant(),
        })
      );
      const ids = candidates.map(({ attempt }) => attempt.id);

      expect(ids).toContain(awaiting);
      expect(ids).not.toContain(settled);
      expect(ids).not.toContain(refunded);
      expect(
        candidates.find(({ attempt }) => attempt.id === awaiting)?.correlationId
      ).toBeString();
    });

    test("claims every outstanding refund across runs instead of rechecking the oldest", async () => {
      const ours = new Set<PaymentAttemptId>();
      for (let index = 0; index < 30; index += 1) {
        ours.add(
          await insertCheckout({
            attemptState: "paid",
            refundState: "required",
          })
        );
      }
      const {
        rows: [{ outstanding }],
      } = await postgres.pool.query<{ outstanding: number }>(
        "select count(*)::int as outstanding from payment_attempts where refund_state = 'required'"
      );
      const limit = 25;
      const runs = Math.ceil(outstanding / limit);

      // Nothing gets refunded between runs, like a back office that has not
      // refunded yet or a Nexi outage, so no claimed attempt leaves the queue.
      // Ordering by age alone would recheck the same oldest batch forever.
      const claimed = new Set<PaymentAttemptId>();
      let checkedAt = Temporal.Now.instant();
      for (let index = 0; index < runs; index += 1) {
        checkedAt = checkedAt.add({ seconds: 1 });
        const batch = await run((repository) =>
          repository.claimAwaitingRefund({ limit, checkedAt })
        );
        expect(batch.length).toBeLessThanOrEqual(limit);
        for (const { attempt } of batch) claimed.add(attempt.id);
      }

      expect(runs).toBeGreaterThan(1);
      for (const id of ours) {
        expect(claimed).toContain(id);
      }
    });

    test("records a refund total that only grows", async () => {
      const paymentAttemptId = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });

      expect(await record(paymentAttemptId, 10_000)).toBe("recorded");
      expect(await record(paymentAttemptId, 10_000)).toBe("unchanged");
      expect(await record(paymentAttemptId, 5000)).toBe("unchanged");
      expect(await readAttempt(paymentAttemptId)).toMatchObject({
        refundState: "refunded",
        refundedAmountValue: 10_000,
      });

      const laterRefundAt = Temporal.Instant.from("2026-10-06T09:00:00Z");
      expect(await record(paymentAttemptId, 29_000, laterRefundAt)).toBe(
        "recorded"
      );
      const attempt = await readAttempt(paymentAttemptId);
      expect(attempt?.refundedAmountValue).toBe(29_000);
      expect(attempt?.refundedAt?.equals(laterRefundAt)).toBe(true);
    });

    test("accepts a refund reported for a paid attempt nobody marked for refund", async () => {
      const paymentAttemptId = await insertCheckout({
        attemptState: "paid",
        refundState: "not_required",
      });

      expect(await record(paymentAttemptId, 29_000)).toBe("recorded");
      expect((await readAttempt(paymentAttemptId))?.refundState).toBe(
        "refunded"
      );
    });

    test("does not record a refund on an attempt that was never paid locally", async () => {
      const paymentAttemptId = await insertCheckout({
        attemptState: "expired",
        refundState: "not_required",
      });

      expect(await record(paymentAttemptId, 29_000)).toBe("not_applicable");
      expect(await readAttempt(paymentAttemptId)).toMatchObject({
        refundState: "not_required",
        refundedAmountValue: null,
        refundedAt: null,
      });
    });
  }
);
