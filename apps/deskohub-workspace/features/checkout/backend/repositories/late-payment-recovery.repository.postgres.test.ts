import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema, NexiWebhookEventIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { toStoredInstant } from "@/db/instant";
import {
  customerEvents,
  discountApplications,
  discountCodeRedemptions,
  discountCodes,
  discounts,
  latePaymentRecoveries,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  canonicalPromotionCodeSchema,
  discountCodeIdSchema,
  promotionCodeIdSchema,
  storedDiscountIdSchema,
} from "@/features/discounts/persistence-contracts";
import { referralFirstBookingLockKey } from "@/features/referrals/advisory-locks";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { rejectCustomerEventInserts } from "@/shared/backend/customer-events/customer-event-outbox.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  fixtureReservationAuthorId,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  LatePaymentRecoveryRepository,
  LatePaymentRecoveryStateError,
  reusableHoldMinimumRemaining,
} from "./late-payment-recovery.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "LatePaymentRecoveryRepository on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];
    const discountIds: string[] = [];

    afterAll(async () => {
      await testDatabase.pool.query(
        "delete from discount_code_redemptions where payment_attempt_id in (select id from payment_attempts where workspace_reservation_id = any($1))",
        [reservationIds]
      );
      await testDatabase.pool.query(
        "delete from discount_applications where workspace_reservation_id = any($1)",
        [reservationIds]
      );
      // Deleting a discount code also deletes its synced promotion code.
      await testDatabase.pool.query(
        "delete from discount_codes where discount_id = any($1)",
        [discountIds]
      );
      await testDatabase.pool.query(
        "delete from discounts where id = any($1)",
        [discountIds]
      );
      await testDatabase.pool.query(
        "delete from late_payment_recoveries where workspace_reservation_id = any($1)",
        [reservationIds]
      );
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
        repository: typeof LatePaymentRecoveryRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* LatePaymentRecoveryRepository);
        }).pipe(
          Effect.provide(LatePaymentRecoveryRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const runResult = <A, E>(
      operation: (
        repository: typeof LatePaymentRecoveryRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* LatePaymentRecoveryRepository);
        }).pipe(
          Effect.provide(LatePaymentRecoveryRepository.Default),
          Effect.provide(testDatabase.layer),
          Effect.result
        )
      );

    /** Inserts a synthetic late-paid checkout whose attempt was expired locally. */
    const insertLatePaidCheckout = async (input: {
      readonly reservationState: "held" | "cancellation_failed" | "cancelled";
      readonly holdExpiresAt: Temporal.Instant;
      readonly lastWebhookEventId?: string;
      readonly checkoutSessionKey?: string;
      readonly createdAt?: Temporal.Instant;
    }) => {
      const id = crypto.randomUUID();
      const dotyposCustomerId = DotyposCustomerIdSchema.make(`customer-${id}`);
      const reservationId = workspaceReservationIdSchema.make(
        `late-reservation-${id}`
      );
      const paymentAttemptId = paymentAttemptIdSchema.make(
        `late-attempt-${id}`
      );
      reservationIds.push(reservationId);
      await Effect.runPromise(
        testDatabase.db.insert(workspaceReservations).values({
          authorAccountId: fixtureReservationAuthorId,
          id: reservationId,
          checkoutSessionKey: input.checkoutSessionKey ?? `late-session-${id}`,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId,
          dotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-original-${id}`
          ),
          reservationState: input.reservationState,
          paymentState: "expired",
          fulfillmentState: "not_started",
          reservationHoldExpiresAt: input.holdExpiresAt,
          reservationDetails: {
            kind: "cowork",
            entryTier: "open-space",
            coffee: false,
          },
          locale: "en-US",
          ...(input.createdAt && { createdAt: input.createdAt }),
        })
      );
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id: paymentAttemptId,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${id}`),
          state: "expired",
          failureCode: "payment_abandoned_after_provider_cutoff",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
          ...(input.lastWebhookEventId && {
            lastWebhookEventId: NexiWebhookEventIdSchema.make(
              input.lastWebhookEventId
            ),
          }),
        })
      );
      await Effect.runPromise(
        testDatabase.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: paymentAttemptId })
          .where(eq(workspaceReservations.id, reservationId))
      );
      return {
        reservationId,
        paymentAttemptId,
        dotyposCustomerId,
        id,
        dotyposReservationId: DotyposReservationIdSchema.make(
          `dotypos-original-${id}`
        ),
      };
    };

    /** Reserves a synthetic discount-code claim for the checkout's attempt. */
    const insertDiscountClaim = async (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly paymentAttemptId: PaymentAttemptId;
      readonly id: string;
    }) => {
      const discountId = storedDiscountIdSchema.make(crypto.randomUUID());
      discountIds.push(discountId);
      await Effect.runPromise(
        testDatabase.db.insert(discounts).values({
          id: discountId,
          percentageBasisPoints: 1000,
          labels: {
            "cs-CZ": "Syntetická sleva",
            "en-US": "Synthetic discount",
          },
        })
      );
      const codeId = discountCodeIdSchema.make(`late-code-${input.id}`);
      await Effect.runPromise(
        testDatabase.db.insert(discountCodes).values({
          id: codeId,
          code: canonicalPromotionCodeSchema.make(
            `LATE-${input.id.toUpperCase()}`
          ),
          enabled: true,
          promotionCodeId: promotionCodeIdSchema.make(codeId),
          discountId,
        })
      );
      const [application] = await Effect.runPromise(
        testDatabase.db
          .insert(discountApplications)
          .values({
            paymentAttemptId: input.paymentAttemptId,
            workspaceReservationId: input.reservationId,
            sequence: 0,
            publicDiscountId: "synthetic-discount",
            label: "Synthetic discount",
            adjustment: { kind: "percentage", basisPoints: 1000 },
            productIdentity: { kind: "cowork", tier: "basic" },
            subtotalBeforeValue: 32_200,
            subtotalBeforeExponent: 2,
            subtotalBeforeCurrency: "CZK",
            appliedAmountValue: 3200,
            appliedAmountExponent: 2,
            appliedAmountCurrency: "CZK",
            subtotalAfterValue: 29_000,
            subtotalAfterExponent: 2,
            subtotalAfterCurrency: "CZK",
            provenance: {
              providerNamespace: "synthetic",
              providerReference: "synthetic",
            },
          })
          .returning({ id: discountApplications.id })
      );
      if (!application) throw new Error("Discount application insert failed.");
      await Effect.runPromise(
        testDatabase.db.insert(discountCodeRedemptions).values({
          codeId,
          applicationId: application.id,
          paymentAttemptId: input.paymentAttemptId,
          dotyposCustomerId: DotyposCustomerIdSchema.make(
            `customer-${input.id}`
          ),
          state: "reserved",
          reservationExpiresAt: Temporal.Now.instant().add({ hours: 1 }),
        })
      );
    };

    const readDiscountClaim = async (paymentAttemptId: PaymentAttemptId) => {
      const [claim] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(discountCodeRedemptions)
          .where(eq(discountCodeRedemptions.paymentAttemptId, paymentAttemptId))
      );
      return claim;
    };

    const startAndClaim = async (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly paymentAttemptId: PaymentAttemptId;
      readonly webhookEventId?: string;
    }) => {
      await run((repository) =>
        repository.start({
          paymentAttemptId: input.paymentAttemptId,
          workspaceReservationId: input.reservationId,
          ...(input.webhookEventId && {
            webhookEventId: NexiWebhookEventIdSchema.make(input.webhookEventId),
          }),
          providerStatus: "EXECUTED",
          verifiedPaidAt: Temporal.Now.instant(),
        })
      );
      const claimed = await run((repository) =>
        repository.claim({
          paymentAttemptId: input.paymentAttemptId,
          staleProcessingBefore: Temporal.Now.instant().subtract({
            minutes: 10,
          }),
        })
      );
      expect(claimed?.state).toBe("processing");
    };

    const readRows = async (input: {
      readonly reservationId: WorkspaceReservationId;
      readonly paymentAttemptId: PaymentAttemptId;
    }) => {
      const [reservation] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.reservationId))
      );
      const [attempt] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, input.paymentAttemptId))
      );
      const recoveries = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(latePaymentRecoveries)
          .where(
            eq(latePaymentRecoveries.paymentAttemptId, input.paymentAttemptId)
          )
      );
      return { reservation, attempt, recoveries };
    };

    test("concurrent webhook and verification starts share one recovery", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });

      // Hold the attempt row so both starts read "no recovery yet" before
      // either can insert, which is exactly the webhook/verification race.
      const blocker = await testDatabase.pool.connect();
      await blocker.query("begin");
      await blocker.query(
        "select id from payment_attempts where id = $1 for update",
        [checkout.paymentAttemptId]
      );
      const pendingStarts = Promise.all(
        [true, false].map((fromWebhook) =>
          runResult((repository) =>
            repository.start({
              paymentAttemptId: checkout.paymentAttemptId,
              workspaceReservationId: checkout.reservationId,
              ...(fromWebhook && {
                webhookEventId: NexiWebhookEventIdSchema.make(
                  `webhook-${checkout.id}`
                ),
              }),
              providerStatus: "EXECUTED",
              verifiedPaidAt: Temporal.Now.instant(),
            })
          )
        )
      );
      await Bun.sleep(250);
      await blocker.query("commit");
      blocker.release();
      const starts = await pendingStarts;

      for (const start of starts) {
        expect(start._tag).toBe("Success");
      }
      const { recoveries } = await readRows(checkout);
      expect(recoveries).toHaveLength(1);
      expect(recoveries[0]?.state).toBe("pending");
    });

    test("recovery start waits on the first-booking lock before attempt rows while settlement serializes", {
      timeout: 12_000,
    }, async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim(checkout);

      const [namespace, lockKey] = referralFirstBookingLockKey(
        checkout.dotyposCustomerId
      );
      const blocker = await testDatabase.pool.connect();
      let waitersObserved = false;
      let attemptRowAvailable = false;
      let operations:
        | Promise<
            [
              Awaited<ReturnType<typeof runResult>>,
              Awaited<ReturnType<typeof runResult>>,
            ]
          >
        | undefined;

      try {
        await blocker.query("begin");
        await blocker.query(
          "select pg_advisory_xact_lock(hashtext($1), hashtext($2))",
          [namespace, lockKey]
        );
        await blocker.query(
          "select payment_attempt_id from late_payment_recoveries where payment_attempt_id = $1 for update",
          [checkout.paymentAttemptId]
        );
        const lockIdentity = await blocker.query(
          "select hashtext($1)::oid as classid, hashtext($2)::oid as objid",
          [namespace, lockKey]
        );
        const classId = lockIdentity.rows[0]?.classid;
        const objectId = lockIdentity.rows[0]?.objid;

        operations = Promise.all([
          runResult((repository) =>
            repository.start({
              paymentAttemptId: checkout.paymentAttemptId,
              workspaceReservationId: checkout.reservationId,
              webhookEventId: NexiWebhookEventIdSchema.make(
                `late-webhook-${checkout.id}`
              ),
              providerStatus: "EXECUTED",
              verifiedPaidAt: Temporal.Now.instant(),
            })
          ),
          runResult((repository) =>
            repository.requireRefund({
              paymentAttemptId: checkout.paymentAttemptId,
              workspaceReservationId: checkout.reservationId,
              failureCode: "late_payment_reservation_unavailable",
              completedAt: Temporal.Now.instant(),
            })
          ),
        ]);

        const waitDeadline = Date.now() + 3_000;
        while (Date.now() < waitDeadline) {
          const waiters = await blocker.query(
            "select count(*)::int as count from pg_locks where locktype = 'advisory' and database = (select oid from pg_database where datname = current_database()) and classid = $1::oid and objid = $2::oid and objsubid = 2 and not granted",
            [classId, objectId]
          );
          if ((waiters.rows[0]?.count ?? 0) >= 2) {
            waitersObserved = true;
            break;
          }
          await Bun.sleep(10);
        }

        const attemptProbe = await testDatabase.pool.connect();
        try {
          await attemptProbe.query("begin");
          await attemptProbe.query("set local lock_timeout = '750ms'");
          await attemptProbe.query(
            "select id from payment_attempts where id = $1 for update",
            [checkout.paymentAttemptId]
          );
          attemptRowAvailable = true;
        } catch {
          attemptRowAvailable = false;
        } finally {
          await attemptProbe.query("rollback").catch(() => undefined);
          attemptProbe.release();
        }
      } finally {
        await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }

      const outcomes = await operations;
      expect(waitersObserved).toBe(true);
      expect(attemptRowAvailable).toBe(true);
      expect(outcomes?.[0]?._tag).toBe("Success");
      expect(outcomes?.[1]?._tag).toBe("Success");

      const { attempt, recoveries } = await readRows(checkout);
      expect(recoveries).toHaveLength(1);
      expect(recoveries[0]?.state).toBe("refund_required");
      expect(attempt?.refundState).toBe("required");
      expect(attempt?.lastWebhookEventId).toBe(
        NexiWebhookEventIdSchema.make(`late-webhook-${checkout.id}`)
      );
    });

    test("a verification-started recovery keeps the attempt's last webhook event", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
        lastWebhookEventId: "earlier-webhook",
      });
      await startAndClaim(checkout);

      await run((repository) =>
        repository.requireRefund({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          failureCode: "late_payment_reservation_unavailable",
          completedAt: Temporal.Now.instant(),
        })
      );

      const { attempt, recoveries } = await readRows(checkout);
      expect(recoveries[0]?.webhookEventId).toBeNull();
      expect(attempt?.lastWebhookEventId).toBe(
        NexiWebhookEventIdSchema.make("earlier-webhook")
      );
      expect(attempt?.refundState).toBe("required");
    });

    test("a webhook joining a verification-started recovery links its event to the attempt", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
        lastWebhookEventId: "earlier-webhook",
      });
      await startAndClaim(checkout);

      await run((repository) =>
        repository.start({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          webhookEventId: NexiWebhookEventIdSchema.make(
            `late-webhook-${checkout.id}`
          ),
          providerStatus: "EXECUTED",
          verifiedPaidAt: Temporal.Now.instant(),
        })
      );
      await run((repository) =>
        repository.requireRefund({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          failureCode: "late_payment_reservation_unavailable",
          completedAt: Temporal.Now.instant(),
        })
      );

      const { attempt, recoveries } = await readRows(checkout);
      expect(recoveries).toHaveLength(1);
      expect(recoveries[0]?.state).toBe("refund_required");
      expect(attempt?.lastWebhookEventId).toBe(
        NexiWebhookEventIdSchema.make(`late-webhook-${checkout.id}`)
      );
    });

    test("refuses to reuse an original hold whose deadline has passed", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 1 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-expired" });

      const result = await runResult((repository) =>
        repository.completeUsingOriginalReservation({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          reservationState: "held",
          completedAt: Temporal.Now.instant(),
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        // A distinct rejection lets recovery continue through recreation.
        expect(result.failure._tag).toBe("OriginalHoldNotReusableError");
      }
      const { reservation, attempt, recoveries } = await readRows(checkout);
      expect(reservation?.paymentState).toBe("expired");
      expect(attempt?.state).toBe("expired");
      expect(recoveries[0]?.state).toBe("processing");
    });

    test("refuses to reuse a hold that expires inside the safety margin", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: Temporal.Now.instant().add(
          reusableHoldMinimumRemaining.subtract({ seconds: 5 })
        ),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-margin" });

      const result = await runResult((repository) =>
        repository.completeUsingOriginalReservation({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          reservationState: "held",
          completedAt: Temporal.Now.instant(),
        })
      );

      expect(result._tag).toBe("Failure");
      expect(result).toMatchObject({
        failure: { _tag: "OriginalHoldNotReusableError" },
      });
    });

    test("refuses to reuse a hold whose cleanup cancellation failed", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancellation_failed",
        holdExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-failed" });

      const result = await runResult((repository) =>
        repository.completeUsingOriginalReservation({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          reservationState: "held",
          completedAt: Temporal.Now.instant(),
        })
      );

      expect(result._tag).toBe("Failure");
      expect(result).toMatchObject({
        failure: { _tag: "OriginalHoldNotReusableError" },
      });
    });

    test("reuses a hold whose deadline is still comfortably in the future", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-current" });

      await run((repository) =>
        repository.completeUsingOriginalReservation({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          reservationState: "held",
          completedAt: Temporal.Now.instant(),
        })
      );

      const { reservation, attempt, recoveries } = await readRows(checkout);
      expect(reservation?.paymentState).toBe("paid");
      expect(attempt?.state).toBe("paid");
      expect(attempt?.refundState).toBe("not_required");
      expect(recoveries[0]?.state).toBe("recovered");
    });

    test("concurrent recovery and refund settlement commit exactly one outcome", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-race" });

      const [recovered, refunded] = await Promise.all([
        runResult((repository) =>
          repository.completeWithReplacement({
            paymentAttemptId: checkout.paymentAttemptId,
            workspaceReservationId: checkout.reservationId,
            recoveredDotyposReservationId: DotyposReservationIdSchema.make(
              `dotypos-replacement-${checkout.id}`
            ),
            reservationState: "confirmed",
            completedAt: Temporal.Now.instant(),
          })
        ),
        runResult((repository) =>
          repository.requireRefund({
            paymentAttemptId: checkout.paymentAttemptId,
            workspaceReservationId: checkout.reservationId,
            failureCode: "late_payment_reservation_unavailable",
            completedAt: Temporal.Now.instant(),
          })
        ),
      ]);

      expect(
        [recovered, refunded].filter((result) => result._tag === "Success")
      ).toHaveLength(1);
      const { reservation, attempt, recoveries } = await readRows(checkout);
      const recovery = recoveries[0];
      if (recovery?.state === "recovered") {
        expect(attempt?.refundState).toBe("not_required");
        expect(reservation?.reservationState).toBe("confirmed");
      } else {
        expect(recovery?.state).toBe("refund_required");
        expect(attempt?.refundState).toBe("required");
        expect(reservation?.reservationState).toBe("cancelled");
      }
    });

    test("only a later active reservation in the same checkout session supersedes", async () => {
      const checkoutSessionKey = `late-session-shared-${crypto.randomUUID()}`;
      const now = Temporal.Now.instant();
      const original = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: now.subtract({ minutes: 30 }),
        checkoutSessionKey,
        createdAt: now.subtract({ minutes: 20 }),
      });
      const earlier = await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: now.add({ minutes: 5 }),
        checkoutSessionKey,
        createdAt: now.subtract({ minutes: 40 }),
      });
      await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: now.subtract({ minutes: 30 }),
        checkoutSessionKey,
        createdAt: now.subtract({ minutes: 10 }),
      });
      await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: now.add({ minutes: 5 }),
        createdAt: now.subtract({ minutes: 5 }),
      });

      expect(
        await run((repository) =>
          repository.hasNewerActiveReservation(original.reservationId)
        )
      ).toBe(false);

      // The session allows one active reservation, so release the earlier
      // one before the customer starts a later checkout.
      await Effect.runPromise(
        testDatabase.db
          .update(workspaceReservations)
          .set({ reservationState: "cancelled" })
          .where(eq(workspaceReservations.id, earlier.reservationId))
      );
      await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: now.add({ minutes: 5 }),
        checkoutSessionKey,
        createdAt: now.subtract({ minutes: 5 }),
      });

      expect(
        await run((repository) =>
          repository.hasNewerActiveReservation(original.reservationId)
        )
      ).toBe(true);
    });

    test("settlement rechecks supersession by a later checkout-session reservation", async () => {
      const checkoutSessionKey = `late-session-shared-${crypto.randomUUID()}`;
      const now = Temporal.Now.instant();
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: now.subtract({ minutes: 30 }),
        checkoutSessionKey,
        createdAt: now.subtract({ minutes: 20 }),
      });
      await startAndClaim({
        ...checkout,
        webhookEventId: "webhook-superseded",
      });
      await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: now.add({ minutes: 5 }),
        checkoutSessionKey,
        createdAt: now.subtract({ minutes: 5 }),
      });

      const result = await runResult((repository) =>
        repository.completeWithReplacement({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          recoveredDotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-replacement-${checkout.id}`
          ),
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toBeInstanceOf(LatePaymentRecoveryStateError);
      }
      const { reservation, attempt, recoveries } = await readRows(checkout);
      expect(reservation?.reservationState).toBe("cancelled");
      expect(reservation?.dotyposReservationId).toBe(
        checkout.dotyposReservationId
      );
      expect(attempt?.state).toBe("expired");
      expect(recoveries[0]?.state).toBe("processing");
    });

    test("attaches a replacement booking after the original reservation was cancelled", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-replace" });
      const replacementId = DotyposReservationIdSchema.make(
        `dotypos-replacement-${checkout.id}`
      );
      const completedAt = Temporal.Now.instant();

      await run((repository) =>
        repository.completeWithReplacement({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          recoveredDotyposReservationId: replacementId,
          reservationState: "confirmed",
          completedAt,
        })
      );

      const { reservation, attempt, recoveries } = await readRows(checkout);
      expect(reservation?.dotyposReservationId).toBe(replacementId);
      expect(reservation?.reservationState).toBe("confirmed");
      expect(reservation?.reservationConfirmedAt).not.toBeNull();
      expect(reservation?.reservationCancelledAt).toBeNull();
      expect(reservation?.paymentState).toBe("paid");
      expect(attempt?.state).toBe("paid");
      expect(recoveries[0]?.state).toBe("recovered");
      expect(recoveries[0]?.recoveredDotyposReservationId).toBe(replacementId);
    });

    const readCustomerEvents = (reservationId: WorkspaceReservationId) =>
      Effect.runPromise(
        testDatabase.db
          .select({
            kind: customerEvents.kind,
            occurredAt: customerEvents.occurredAt,
            dotyposCustomerId: customerEvents.dotyposCustomerId,
          })
          .from(customerEvents)
          .where(eq(customerEvents.workspaceReservationId, reservationId))
      );

    test("records one booked event when settlement confirms the reservation", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-booked" });
      const completedAt = Temporal.Now.instant();

      await run((repository) =>
        repository.completeWithReplacement({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          recoveredDotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-replacement-${checkout.id}`
          ),
          reservationState: "confirmed",
          completedAt,
        })
      );

      const { reservation } = await readRows(checkout);
      expect(await readCustomerEvents(checkout.reservationId)).toEqual([
        {
          kind: "reservation-booked",
          occurredAt: toStoredInstant(completedAt),
          dotyposCustomerId: reservation!.dotyposCustomerId,
        },
      ]);
    });

    test("rolls the late-payment settlement back with a failed event write", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim({
        ...checkout,
        webhookEventId: "webhook-booked-failure",
      });
      const before = await readRows(checkout);
      const cleanup = await rejectCustomerEventInserts(
        testDatabase.pool,
        `new.workspace_reservation_id = '${checkout.reservationId}'`
      );
      const result = await runResult((repository) =>
        repository.completeWithReplacement({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          recoveredDotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-replacement-${checkout.id}`
          ),
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      ).finally(cleanup);

      expect(result._tag).toBe("Failure");
      expect(await readRows(checkout)).toEqual(before);
      expect(await readCustomerEvents(checkout.reservationId)).toEqual([]);
    });

    test("records no booked event for a held recovery or a refund", async () => {
      const held = await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
      });
      await startAndClaim({ ...held, webhookEventId: "webhook-held" });
      const refunded = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim({ ...refunded, webhookEventId: "webhook-refund" });

      await run((repository) =>
        repository.completeUsingOriginalReservation({
          paymentAttemptId: held.paymentAttemptId,
          workspaceReservationId: held.reservationId,
          reservationState: "held",
          completedAt: Temporal.Now.instant(),
        })
      );
      await run((repository) =>
        repository.requireRefund({
          paymentAttemptId: refunded.paymentAttemptId,
          workspaceReservationId: refunded.reservationId,
          failureCode: "late_payment_reservation_unavailable",
          completedAt: Temporal.Now.instant(),
        })
      );

      expect(await readCustomerEvents(held.reservationId)).toEqual([]);
      expect(await readCustomerEvents(refunded.reservationId)).toEqual([]);
    });

    test("a superseded attempt Nexi already refunded stays refunded without touching the reservation", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await startAndClaim({ ...checkout, webhookEventId: "webhook-refunded" });
      const newerAttemptId = paymentAttemptIdSchema.make(
        `late-attempt-newer-${checkout.id}`
      );
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id: newerAttemptId,
          workspaceReservationId: checkout.reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-newer-${checkout.id}`),
          state: "created",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
        })
      );
      await Effect.runPromise(
        testDatabase.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: newerAttemptId })
          .where(eq(workspaceReservations.id, checkout.reservationId))
      );
      await Effect.runPromise(
        testDatabase.db
          .update(paymentAttempts)
          .set({
            state: "paid",
            failureCode: null,
            refundState: "refunded",
            refundedAmountValue: 29_000,
            refundedAt: Temporal.Now.instant(),
          })
          .where(eq(paymentAttempts.id, checkout.paymentAttemptId))
      );

      await run((repository) =>
        repository.requireRefund({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          failureCode: "late_payment_reservation_unavailable",
          completedAt: Temporal.Now.instant(),
        })
      );

      const { reservation, attempt, recoveries } = await readRows(checkout);
      expect(attempt?.refundState).toBe("refunded");
      expect(attempt?.refundedAmountValue).toBe(29_000);
      expect(reservation?.activePaymentAttemptId).toBe(newerAttemptId);
      expect(reservation?.paymentState).toBe("expired");
      expect(recoveries[0]?.state).toBe("refund_required");
    });

    test("redeems the attempt's discount claim when recovery settles", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "held",
        holdExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
      });
      await insertDiscountClaim(checkout);
      await startAndClaim({ ...checkout, webhookEventId: "webhook-discount" });

      await run((repository) =>
        repository.completeUsingOriginalReservation({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );

      const { recoveries } = await readRows(checkout);
      const claim = await readDiscountClaim(checkout.paymentAttemptId);
      expect(claim?.state).toBe("redeemed");
      expect(claim?.redeemedAt?.toString()).toBe(
        recoveries[0]?.verifiedPaidAt.toString()
      );
    });

    test("rolls the discount redemption back with a settlement that fails after redeeming", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      await insertDiscountClaim(checkout);
      await startAndClaim({ ...checkout, webhookEventId: "webhook-rollback" });
      // Another reservation already owns the replacement booking, so the
      // reservation update after the redemption violates its unique index.
      const other = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });

      const result = await runResult((repository) =>
        repository.completeWithReplacement({
          paymentAttemptId: checkout.paymentAttemptId,
          workspaceReservationId: checkout.reservationId,
          recoveredDotyposReservationId: other.dotyposReservationId,
          reservationState: "confirmed",
          completedAt: Temporal.Now.instant(),
        })
      );

      // The failing reservation update runs after the redemption.
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "EffectDrizzleQueryError",
          query: expect.stringContaining('update "workspace_reservations"'),
        },
      });
      const claim = await readDiscountClaim(checkout.paymentAttemptId);
      expect(claim?.state).toBe("reserved");
      expect(claim?.redeemedAt).toBeNull();
      const { reservation, attempt, recoveries } = await readRows(checkout);
      expect(reservation?.dotyposReservationId).toBe(
        checkout.dotyposReservationId
      );
      expect(attempt?.state).toBe("expired");
      expect(recoveries[0]?.state).toBe("processing");
    });
  }
);
