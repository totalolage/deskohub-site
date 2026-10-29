import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import {
  latePaymentRecoveries,
  paymentAttempts,
  workspaceReservations,
} from "@/db/schema";
import {
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { WorkspaceReservationStateError } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  type ReservationFixtureInput,
  type ReservationFixtureStage,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  FulfillmentLedger,
  fulfillmentEmailFailureCode,
} from "./fulfillment-ledger.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// Fixture times sit decades in the past, as in the reservation repository
// suite, so table-wide selects only reach rows this file inserted.
const at = (minutes: number) =>
  Temporal.Instant.from("1990-01-01T12:00:00Z").add({ minutes });

describe.skipIf(!testDatabase)(
  "FulfillmentLedger state guards on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const reservationIds: WorkspaceReservationId[] = [];

    afterAll(async () => {
      for (const table of [
        "late_payment_recoveries",
        "reservation_access_grants",
        "payment_attempts",
      ]) {
        await testDatabase.pool.query(
          `delete from ${table} where workspace_reservation_id = any($1)`,
          [reservationIds]
        );
      }
      await testDatabase.pool.query(
        "delete from workspace_reservations where id = any($1)",
        [reservationIds]
      );
    });

    const run = <A, E>(
      operation: (
        ledger: typeof FulfillmentLedger.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* FulfillmentLedger);
        }).pipe(
          Effect.provide(
            FulfillmentLedger.Default.pipe(Layer.provide(testDatabase.layer))
          )
        )
      );

    const runFailure = <A, E>(
      operation: (
        ledger: typeof FulfillmentLedger.Service
      ) => Effect.Effect<A, E>
    ) => run((ledger) => Effect.flip(operation(ledger)));

    /**
     * Inserts a synthetic reservation, held and unpaid unless the stage says
     * otherwise, whose events happened at `at(0)`. Whatever its stage, its
     * hold expires at `at(0)` unless the overrides say otherwise.
     */
    const insertReservation = async (
      stage: Partial<ReservationFixtureStage> = {},
      overrides: ReservationFixtureInput["overrides"] = {}
    ) => {
      const { id } = await Effect.runPromise(
        workspaceFixtures(testDatabase.db).reservation({
          stage: { reservation: "held", ...stage },
          at: at(0),
          overrides: { reservationHoldExpiresAt: at(0), ...overrides },
        })
      );
      reservationIds.push(id);
      return id;
    };

    /** Inserts a payment attempt and makes it the reservation's active one. */
    const insertActivePaymentAttempt = async (
      reservationId: WorkspaceReservationId,
      values: Partial<typeof paymentAttempts.$inferInsert> = {}
    ) => {
      const key = crypto.randomUUID();
      const id = paymentAttemptIdSchema.make(`attempt-${key}`);
      await Effect.runPromise(
        testDatabase.db.insert(paymentAttempts).values({
          id,
          workspaceReservationId: reservationId,
          provider: "nexi",
          providerOrderId: NexiOrderIdSchema.make(`order-${key}`),
          state: "paid",
          amountValue: 29_000,
          amountExponent: 2,
          currency: "CZK",
          ...values,
        })
      );
      await Effect.runPromise(
        testDatabase.db
          .update(workspaceReservations)
          .set({ activePaymentAttemptId: id })
          .where(eq(workspaceReservations.id, reservationId))
      );
      return id;
    };

    const insertLatePaymentRecovery = async (
      reservationId: WorkspaceReservationId,
      paymentAttemptId: PaymentAttemptId,
      state: "pending" | "recovered" | "refund_required"
    ) => {
      await Effect.runPromise(
        testDatabase.db.insert(latePaymentRecoveries).values({
          paymentAttemptId,
          workspaceReservationId: reservationId,
          state,
          originalDotyposReservationId: DotyposReservationIdSchema.make(
            `dotypos-original-${crypto.randomUUID()}`
          ),
          verifiedPaidAt: at(0),
          ...(state === "recovered" && {
            completedAt: at(1),
            recoveredDotyposReservationId: DotyposReservationIdSchema.make(
              `dotypos-recovered-${crypto.randomUUID()}`
            ),
          }),
          ...(state === "refund_required" && {
            completedAt: at(1),
            failureCode: "late_payment_snapshot_unavailable",
          }),
        })
      );
    };

    const readReservation = async (id: WorkspaceReservationId) => {
      const [reservation] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id))
      );
      return reservation;
    };

    describe("paid fulfillment", () => {
      const claim = (id: WorkspaceReservationId) =>
        run((repository) =>
          repository.claimPaidFulfillment({
            id,
            staleProcessingBefore: at(10),
          })
        );

      test.each([
        ["a held booking not yet fulfilled", { payment: "paid" }, {}],
        [
          "a confirmed booking whose fulfillment failed",
          { reservation: "confirmed", payment: "paid", fulfillment: "failed" },
          { fulfillmentFailureCode: fulfillmentEmailFailureCode },
        ],
        [
          "a stale processing claim",
          { payment: "paid", fulfillment: "processing" },
          { updatedAt: at(0) },
        ],
      ] as const)("claims %s", async (_label, stage, overrides) => {
        const id = await insertReservation(stage, overrides);

        const claimed = await claim(id);

        expect(claimed?.id).toBe(id);
        expect((await readReservation(id))?.fulfillmentState).toBe(
          "processing"
        );
      });

      test.each<readonly [string, Partial<ReservationFixtureStage>]>([
        ["an unpaid booking", { payment: "pending" }],
        ["a cancelled booking", { reservation: "cancelled", payment: "paid" }],
        [
          "a fresh processing claim",
          { payment: "paid", fulfillment: "processing" },
        ],
        ["a fulfilled booking", { payment: "paid", fulfillment: "fulfilled" }],
      ])("does not claim %s", async (_label, stage) => {
        const id = await insertReservation(stage);

        expect(await claim(id)).toBeNull();
        expect((await readReservation(id))?.fulfillmentState).toBe(
          stage.fulfillment ?? "not_started"
        );
      });

      test("leaves an active attempt under late-payment recovery to that recovery", async () => {
        const underRecovery = await insertReservation({ payment: "paid" });
        await insertLatePaymentRecovery(
          underRecovery,
          await insertActivePaymentAttempt(underRecovery),
          "pending"
        );
        const recovered = await insertReservation({ payment: "paid" });
        await insertLatePaymentRecovery(
          recovered,
          await insertActivePaymentAttempt(recovered),
          "recovered"
        );

        expect(await claim(underRecovery)).toBeNull();
        expect((await claim(recovered))?.id).toBe(recovered);
      });

      test("keeps a retried failure once the retry's delivery succeeds", async () => {
        const id = await insertReservation(
          { reservation: "confirmed", payment: "paid", fulfillment: "failed" },
          {
            fulfillmentFailedAt: at(1),
            fulfillmentFailureCode: fulfillmentEmailFailureCode,
          }
        );
        const customerEmailDeliveryId =
          EmailDeliveryIdSchema.make("retried-delivery");

        expect((await claim(id))?.id).toBe(id);
        expect(await readReservation(id)).toMatchObject({
          fulfillmentState: "processing",
          fulfillmentFailedAt: at(1),
        });
        await run((repository) =>
          repository.markAwaitingCustomerEmailDelivery({
            id,
            customerEmailDeliveryId,
            expectedActiveCustomerEmailDeliveryId: null,
          })
        );
        await run((repository) =>
          repository.markCustomerEmailDeliveryFulfilled({
            customerEmailDeliveryId,
            fulfilledAt: at(2),
          })
        );

        expect(await readReservation(id)).toMatchObject({
          fulfillmentState: "fulfilled",
          fulfilledAt: at(2),
          fulfillmentFailedAt: at(1),
        });
      });

      test("reports the late-payment recovery that blocks the claim", async () => {
        const refundRequired = await insertReservation({ payment: "paid" });
        await insertLatePaymentRecovery(
          refundRequired,
          await insertActivePaymentAttempt(refundRequired),
          "refund_required"
        );
        const recovered = await insertReservation({ payment: "paid" });
        await insertLatePaymentRecovery(
          recovered,
          await insertActivePaymentAttempt(recovered),
          "recovered"
        );
        const supersededRecovery = await insertReservation({ payment: "paid" });
        await insertLatePaymentRecovery(
          supersededRecovery,
          await insertActivePaymentAttempt(supersededRecovery),
          "pending"
        );
        await insertActivePaymentAttempt(supersededRecovery);
        const progress = (id: WorkspaceReservationId) =>
          run((repository) => repository.findPaidFulfillmentProgress(id));

        expect(await claim(refundRequired)).toBeNull();
        expect(await progress(refundRequired)).toEqual({
          paymentState: "paid",
          reservationState: "held",
          fulfillmentState: "not_started",
          latePaymentRecoveryState: "refund_required",
        });
        expect(await progress(recovered)).toMatchObject({
          latePaymentRecoveryState: null,
        });
        expect(await progress(supersededRecovery)).toMatchObject({
          latePaymentRecoveryState: null,
        });
        expect(
          await progress(
            workspaceReservationIdSchema.make("reservation-missing")
          )
        ).toBeNull();
      });

      test("marks only a processing paid booking fulfilled", async () => {
        const processing = await insertReservation({
          payment: "paid",
          fulfillment: "processing",
        });
        const failed = await insertReservation(
          { payment: "paid", fulfillment: "failed" },
          { fulfillmentFailureCode: "provider_unavailable" }
        );

        const customerEmailDeliveryId =
          EmailDeliveryIdSchema.make("accepted-delivery");
        await run((repository) =>
          repository.markFulfilled({
            id: processing,
            fulfilledAt: at(2),
            customerEmailDeliveryId,
          })
        );
        const error = await runFailure((repository) =>
          repository.markFulfilled({
            id: failed,
            fulfilledAt: at(2),
            customerEmailDeliveryId,
          })
        );

        expect(await readReservation(processing)).toMatchObject({
          fulfillmentState: "fulfilled",
          fulfilledAt: at(2),
        });
        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readReservation(failed)).toMatchObject({
          fulfillmentState: "failed",
          fulfillmentFailureCode: "provider_unavailable",
        });
      });

      test("replaces a superseded delivery so its stale webhook finds nothing", async () => {
        const superseded = EmailDeliveryIdSchema.make(
          `superseded-${crypto.randomUUID()}`
        );
        const recovered = EmailDeliveryIdSchema.make(
          `console-recovered-${crypto.randomUUID()}`
        );
        const id = await insertReservation(
          { payment: "paid", fulfillment: "processing" },
          { activeCustomerEmailDeliveryId: superseded }
        );

        await run((repository) =>
          repository.markFulfilled({
            id,
            fulfilledAt: at(2),
            customerEmailDeliveryId: recovered,
          })
        );

        expect(await readReservation(id)).toMatchObject({
          fulfillmentState: "fulfilled",
          activeCustomerEmailDeliveryId: recovered,
        });
        expect(
          await run((repository) =>
            repository.findByActiveCustomerEmailDeliveryId(superseded)
          )
        ).toBeNull();
        expect(
          (
            await run((repository) =>
              repository.findByActiveCustomerEmailDeliveryId(recovered)
            )
          )?.id
        ).toBe(id);
      });
    });
  }
);
