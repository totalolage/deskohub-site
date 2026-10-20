import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { makeDatabaseClient, makeDatabasePool } from "@/db/database-client";
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
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { PaymentRefundRepository } from "./payment-refund.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "PaymentRefundRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from payment_attempts where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      await testDatabase.pool.query(
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
          Effect.provide(testDatabase.layer)
        )
      );

    /** Inserts a synthetic cancelled checkout with one Nexi attempt. */
    const insertCheckout = async (input: {
      readonly attemptState: "paid" | "expired";
      readonly refundState: "not_required" | "required";
      readonly createdAt?: Temporal.Instant;
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
        testDatabase.db.insert(workspaceReservations).values({
          authorAccountId: fixtureReservationAuthorId,
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
        testDatabase.db.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
          state: input.attemptState,
          ...(input.attemptState === "expired" && {
            failureCode: "payment_abandoned_after_provider_cutoff",
          }),
          refundState: input.refundState,
          ...(input.createdAt && { createdAt: input.createdAt }),
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
        })
      );
      return paymentAttemptId;
    };

    const readAttempt = async (paymentAttemptId: PaymentAttemptId) => {
      const [attempt] = await Effect.runPromise(
        testDatabase.db
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

    const recentPaymentsSince = Temporal.Now.instant().subtract({
      hours: 30 * 24,
    });

    /** Claims a batch in which every eligible attempt is due for a check. */
    const claim = (input: {
      readonly limit: number;
      readonly checkedAt?: Temporal.Instant;
      readonly lastCheckedBefore?: Temporal.Instant;
    }) => {
      const checkedAt = input.checkedAt ?? Temporal.Now.instant();
      return run((repository) =>
        repository.claimRefundChecks({
          limit: input.limit,
          checkedAt,
          lastCheckedBefore: input.lastCheckedBefore ?? checkedAt,
          recentPaymentsSince,
        })
      );
    };

    const claimedIds = async (input: Parameters<typeof claim>[0]) =>
      (await claim(input)).map(({ attempt }) => attempt.id);

    const countPaymentAttempts = async () => {
      const {
        rows: [{ attempts }],
      } = await testDatabase.pool.query<{ attempts: number }>(
        "select count(*)::int as attempts from payment_attempts"
      );
      return attempts;
    };

    test("lists paid attempts awaiting a refund and recent paid attempts without a full refund", async () => {
      const awaiting = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });
      const recentlyPaid = await insertCheckout({
        attemptState: "paid",
        refundState: "not_required",
      });
      const paidBeforeWindow = await insertCheckout({
        attemptState: "paid",
        refundState: "not_required",
        createdAt: recentPaymentsSince.subtract({ hours: 1 }),
      });
      const neverPaid = await insertCheckout({
        attemptState: "expired",
        refundState: "not_required",
      });
      const refunded = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });
      expect(await record(refunded, 29_000)).toBe("recorded");

      const candidates = await claim({ limit: 1_000 });
      const ids = candidates.map(({ attempt }) => attempt.id);

      expect(ids).toContain(awaiting);
      expect(ids).toContain(recentlyPaid);
      expect(ids).not.toContain(paidBeforeWindow);
      expect(ids).not.toContain(neverPaid);
      expect(ids).not.toContain(refunded);
      expect(
        candidates.find(({ attempt }) => attempt.id === awaiting)?.correlationId
      ).toBeString();
    });

    test("keeps checking a recent partially refunded payment until it is fully refunded", async () => {
      const paymentAttemptId = await insertCheckout({
        attemptState: "paid",
        refundState: "not_required",
      });

      expect(await record(paymentAttemptId, 10_000)).toBe("recorded");
      expect(await claimedIds({ limit: 1_000 })).toContain(paymentAttemptId);

      expect(await record(paymentAttemptId, 29_000)).toBe("recorded");
      expect(await claimedIds({ limit: 1_000 })).not.toContain(
        paymentAttemptId
      );
    });

    test("leaves an attempt alone until its last check is old enough", async () => {
      const paymentAttemptId = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });
      const firstCheck = Temporal.Now.instant();
      expect(
        await claimedIds({ limit: 1_000, checkedAt: firstCheck })
      ).toContain(paymentAttemptId);

      const nextRun = firstCheck.add({ hours: 1 });
      expect(
        await claimedIds({
          limit: 1_000,
          checkedAt: nextRun,
          lastCheckedBefore: nextRun.subtract({ hours: 6 }),
        })
      ).not.toContain(paymentAttemptId);
      expect(
        await claimedIds({
          limit: 1_000,
          checkedAt: firstCheck.add({ hours: 6 }),
          lastCheckedBefore: firstCheck,
        })
      ).toContain(paymentAttemptId);
    });

    test("gives a released claim back its previous check time without undoing a later claim", async () => {
      const paymentAttemptId = await insertCheckout({
        attemptState: "paid",
        refundState: "required",
      });
      const claimOurs = async (checkedAt: Temporal.Instant) => {
        const claimed = (await claim({ limit: 1_000, checkedAt })).find(
          ({ attempt }) => attempt.id === paymentAttemptId
        );
        if (!claimed) throw new Error("Expected the attempt to be claimed");
        return claimed;
      };
      const release = (claimed: Awaited<ReturnType<typeof claimOurs>>) =>
        run((repository) =>
          repository.releaseRefundCheck({ ...claimed, id: paymentAttemptId })
        );
      const readCheckedAt = async () =>
        (await readAttempt(paymentAttemptId))?.refundCheckedAt?.toString() ??
        null;

      const firstCheck = Temporal.Instant.fromEpochMilliseconds(Date.now());
      const first = await claimOurs(firstCheck);
      expect(first.previousCheckedAt).toBeNull();
      const secondCheck = firstCheck.add({ hours: 7 });
      const second = await claimOurs(secondCheck);
      expect(second.previousCheckedAt?.equals(firstCheck)).toBe(true);

      // The first claim is stale: releasing it keeps the later stamp.
      await release(first);
      expect(await readCheckedAt()).toBe(secondCheck.toString());

      await release(second);
      expect(await readCheckedAt()).toBe(firstCheck.toString());
    });

    test("checks a recent unflagged payment while a full batch of refunds stays outstanding", async () => {
      const limit = 50;
      for (let index = 0; index < limit; index += 1) {
        await insertCheckout({ attemptState: "paid", refundState: "required" });
      }
      const unflagged = await insertCheckout({
        attemptState: "paid",
        refundState: "not_required",
      });

      // Nobody refunds the outstanding attempts between runs, so they stay
      // eligible. Fair scheduling must still reach the unflagged payment.
      const runs = Math.ceil((await countPaymentAttempts()) / limit) + 1;
      const claimed = new Set<PaymentAttemptId>();
      let checkedAt = Temporal.Now.instant();
      for (let index = 0; index < runs; index += 1) {
        checkedAt = checkedAt.add({ seconds: 1 });
        for (const id of await claimedIds({ limit, checkedAt })) {
          claimed.add(id);
        }
      }

      expect(claimed).toContain(unflagged);
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
      const limit = 25;
      const runs = Math.ceil((await countPaymentAttempts()) / limit);

      // Nothing gets refunded between runs, like a back office that has not
      // refunded yet or a Nexi outage, so no claimed attempt leaves the queue.
      // Ordering by age alone would recheck the same oldest batch forever.
      const claimed = new Set<PaymentAttemptId>();
      let checkedAt = Temporal.Now.instant();
      for (let index = 0; index < runs; index += 1) {
        checkedAt = checkedAt.add({ seconds: 1 });
        const batch = await claimedIds({ limit, checkedAt });
        expect(batch.length).toBeLessThanOrEqual(limit);
        for (const id of batch) claimed.add(id);
      }

      expect(runs).toBeGreaterThan(1);
      for (const id of ours) {
        expect(claimed).toContain(id);
      }
    });

    test("never claims more than the limit when Postgres re-runs the claim subquery", async () => {
      // Statistics taken while payment_attempts was empty make Postgres pick a
      // nested-loop semi-join that re-runs the claim subquery for every row it
      // updates. These settings force that plan on a dedicated connection.
      const rescanningPool = makeDatabasePool({
        connectionString: process.env.WORKSPACE_TEST_DATABASE_URL ?? "",
        max: 1,
        options:
          "-c enable_hashjoin=off -c enable_mergejoin=off -c enable_hashagg=off -c enable_material=off -c enable_sort=off",
      });
      try {
        const db = await Effect.runPromise(makeDatabaseClient(rescanningPool));
        for (let index = 0; index < 30; index += 1) {
          await insertCheckout({
            attemptState: "paid",
            refundState: "required",
          });
        }
        const limit = 25;

        const batch = await Effect.runPromise(
          Effect.gen(function* () {
            const repository = yield* PaymentRefundRepository;
            const checkedAt = Temporal.Now.instant();
            return yield* repository.claimRefundChecks({
              limit,
              checkedAt,
              lastCheckedBefore: checkedAt,
              recentPaymentsSince,
            });
          }).pipe(
            Effect.provide(PaymentRefundRepository.Default),
            Effect.provide(
              Layer.succeed(WorkspaceDatabase, WorkspaceDatabase.of({ db }))
            )
          )
        );

        expect(batch).toHaveLength(limit);
      } finally {
        await rescanningPool.end();
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
