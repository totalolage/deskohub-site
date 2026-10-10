import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { NexiOrderIdSchema, NexiWebhookEventIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
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
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  LatePaymentRecoveryRepository,
  reusableHoldMinimumRemaining,
} from "./late-payment-recovery.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

describe.skipIf(!testDatabase)(
  "LatePaymentRecoveryRepository on disposable Postgres",
  () => {
    const postgres = testDatabase;
    if (!postgres) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      await postgres.pool.query(
        "delete from late_payment_recoveries where workspace_reservation_id = any($1)",
        [reservationIds]
      );
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
        repository: typeof LatePaymentRecoveryRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* LatePaymentRecoveryRepository);
        }).pipe(
          Effect.provide(LatePaymentRecoveryRepository.Default),
          Effect.provide(postgres.layer)
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
          Effect.provide(postgres.layer),
          Effect.result
        )
      );

    /** Inserts a synthetic late-paid checkout whose attempt was expired locally. */
    const insertLatePaidCheckout = async (input: {
      readonly reservationState: "held" | "cancellation_failed" | "cancelled";
      readonly holdExpiresAt: Temporal.Instant;
      readonly lastWebhookEventId?: string;
    }) => {
      const id = crypto.randomUUID();
      const reservationId = workspaceReservationIdSchema.make(
        `late-reservation-${id}`
      );
      const paymentAttemptId = paymentAttemptIdSchema.make(
        `late-attempt-${id}`
      );
      reservationIds.push(reservationId);
      await Effect.runPromise(
        postgres.db.insert(workspaceReservations).values({
          id: reservationId,
          checkoutSessionKey: `late-session-${id}`,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(`attempt-${id}`),
          dotyposCustomerId: DotyposCustomerIdSchema.make(`customer-${id}`),
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
        })
      );
      await Effect.runPromise(
        postgres.db.insert(paymentAttempts).values({
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
        postgres.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: paymentAttemptId })
          .where(eq(workspaceReservations.id, reservationId))
      );
      return { reservationId, paymentAttemptId, id };
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
        postgres.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, input.reservationId))
      );
      const [attempt] = await Effect.runPromise(
        postgres.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, input.paymentAttemptId))
      );
      const recoveries = await Effect.runPromise(
        postgres.db
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
      const blocker = await postgres.pool.connect();
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

    test("finds the latest recovery for the customer status of a reservation", async () => {
      const checkout = await insertLatePaidCheckout({
        reservationState: "cancelled",
        holdExpiresAt: Temporal.Now.instant().subtract({ minutes: 30 }),
      });
      expect(
        await run((repository) =>
          repository.findLatestByWorkspaceReservationId(checkout.reservationId)
        )
      ).toBeNull();

      await startAndClaim({ ...checkout, webhookEventId: "webhook-status" });

      const latest = await run((repository) =>
        repository.findLatestByWorkspaceReservationId(checkout.reservationId)
      );
      expect(latest?.paymentAttemptId).toBe(checkout.paymentAttemptId);
      expect(latest?.state).toBe("processing");
    });
  }
);
