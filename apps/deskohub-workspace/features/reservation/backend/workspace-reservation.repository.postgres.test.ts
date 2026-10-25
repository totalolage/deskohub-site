import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { EmailDeliveryIdSchema } from "@deskohub/email";
import {
  AlgoPinSchema,
  IgloohomeDeviceIdSchema,
  IgloohomePinIdSchema,
} from "@deskohub/igloohome";
import { NexiOrderIdSchema } from "@deskohub/nexi";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  customerEvents,
  latePaymentRecoveries,
  paymentAttempts,
  reservationAccessGrants,
  workspaceReservations,
} from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
  type PaymentAttemptId,
  paymentAttemptIdSchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { recordCustomerEvent } from "@/shared/backend/customer-events/customer-event-outbox";
import { rejectCustomerEventInserts } from "@/shared/backend/customer-events/customer-event-outbox.test-utils";
import {
  fixtureReservationAuthorId,
  type ReservationFixtureInput,
  type ReservationFixtureStage,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  fulfillmentEmailFailureCode,
  WorkspaceReservationRepository,
  WorkspaceReservationStateError,
} from "./workspace-reservation.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// Fixture times sit decades in the past so the repository's table-wide
// expired-hold selects only reach rows this file inserted.
const at = (minutes: number) =>
  Temporal.Instant.from("1990-01-01T12:00:00Z").add({ minutes });

describe.skipIf(!testDatabase)(
  "WorkspaceReservationRepository state guards on disposable Postgres",
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
        repository: typeof WorkspaceReservationRepository.Service
      ) => Effect.Effect<A, E>
    ) =>
      Effect.runPromise(
        Effect.gen(function* () {
          return yield* operation(yield* WorkspaceReservationRepository);
        }).pipe(
          Effect.provide(WorkspaceReservationRepository.Default),
          Effect.provide(testDatabase.layer)
        )
      );

    const runFailure = <A, E>(
      operation: (
        repository: typeof WorkspaceReservationRepository.Service
      ) => Effect.Effect<A, E>
    ) => run((repository) => Effect.flip(operation(repository)));

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

    const readPaymentAttempt = async (id: PaymentAttemptId) => {
      const [attempt] = await Effect.runPromise(
        testDatabase.db
          .select()
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, id))
      );
      return attempt;
    };

    describe("expired holds", () => {
      test("selects unpaid expired holds and queues holds with skipped cleanup behind fresh ones", async () => {
        const skippedCleanup = await insertReservation(
          { payment: "failed" },
          { reservationHoldExpiredAt: at(120) }
        );
        const freshlyExpired = await insertReservation(
          {},
          { reservationHoldExpiresAt: at(60) }
        );
        const fixtureIds = new Set([
          skippedCleanup,
          freshlyExpired,
          await insertReservation({ payment: "paid" }),
          await insertReservation({}, { reservationHoldExpiresAt: at(240) }),
          await insertReservation({ reservation: "hold_expired" }),
        ]);

        const holds = await run((repository) =>
          repository.selectExpiredHolds({ now: at(180), limit: 1000 })
        );
        const limited = await run((repository) =>
          repository.selectExpiredHolds({ now: at(180), limit: 1 })
        );

        expect(
          holds.map(({ id }) => id).filter((id) => fixtureIds.has(id))
        ).toEqual([freshlyExpired, skippedCleanup]);
        expect(limited).toHaveLength(1);
      });

      test("lists the Dotypos holds of expired unpaid reservations without a live payment", async () => {
        const expectedIds = [];
        for (const paymentState of [
          "not_started",
          "failed",
          "cancelled",
          "expired",
        ] as const) {
          const id = await insertReservation({ payment: paymentState });
          expectedIds.push((await readReservation(id))?.dotyposReservationId);
        }
        const excludedIds = [];
        for (const [stage, overrides] of [
          [{ payment: "pending" }, {}],
          [{ payment: "paid" }, {}],
          [{}, { reservationHoldExpiresAt: at(240) }],
          [{ reservation: "confirmed" }, {}],
        ] as const) {
          const id = await insertReservation(stage, overrides);
          excludedIds.push((await readReservation(id))?.dotyposReservationId);
        }

        const ids = await run((repository) =>
          repository.selectExpiredHoldDotyposReservationIds({ now: at(180) })
        );

        expect(ids).toEqual(expect.arrayContaining(expectedIds));
        for (const excludedId of excludedIds) {
          expect(ids).not.toContain(excludedId);
        }
      });

      test("records a skipped cleanup on an unpaid expired hold without changing its state", async () => {
        const id = await insertReservation();

        await run((repository) =>
          repository.recordHoldCleanupSkipped({
            id,
            holdExpiredAt: at(30),
            failureCode: "provider_unavailable",
          })
        );

        const stored = await readReservation(id);
        expect(stored?.reservationState).toBe("held");
        expect(stored?.reservationHoldExpiredAt).toEqual(at(30));
        expect(stored?.failureCode).toBe("provider_unavailable");
      });

      test.each([
        ["a paid hold", { payment: "paid" }, {}],
        [
          "a hold that has not expired",
          {},
          { reservationHoldExpiresAt: at(60) },
        ],
        [
          "a reservation that is no longer held",
          { reservation: "confirmed" },
          {},
        ],
      ] as const)(
        "refuses to record a skipped cleanup on %s",
        async (_label, stage, overrides) => {
          const id = await insertReservation(stage, overrides);

          const error = await runFailure((repository) =>
            repository.recordHoldCleanupSkipped({
              id,
              holdExpiredAt: at(30),
              failureCode: "provider_unavailable",
            })
          );

          expect(error).toBeInstanceOf(WorkspaceReservationStateError);
          const stored = await readReservation(id);
          expect(stored?.reservationHoldExpiredAt).toBeNull();
          expect(stored?.failureCode).toBeNull();
        }
      );
    });

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

    describe("fulfillment delivery outcomes", () => {
      const markDeliveryFailed = (
        id: WorkspaceReservationId,
        failureCode = fulfillmentEmailFailureCode
      ) =>
        run((repository) =>
          repository.markFulfillmentDeliveryFailed({
            id,
            failureCode,
            failedAt: at(5),
          })
        );

      test.each([
        ["a processing fulfillment", "processing", {}],
        ["an earlier fulfillment", "fulfilled", { fulfilledAt: at(4) }],
        [
          "an earlier failure with the same code",
          "failed",
          {
            fulfillmentFailedAt: at(4),
            fulfillmentFailureCode: fulfillmentEmailFailureCode,
          },
        ],
      ] as const)(
        "records a delivery failure over %s",
        async (_label, fulfillment, overrides) => {
          const id = await insertReservation(
            { payment: "paid", fulfillment },
            overrides
          );

          expect((await markDeliveryFailed(id))?.id).toBe(id);
          expect(await readReservation(id)).toMatchObject({
            fulfillmentState: "failed",
            fulfilledAt: null,
            fulfillmentFailedAt: at(5),
            fulfillmentFailureCode: fulfillmentEmailFailureCode,
          });
        }
      );

      test.each([
        [
          "a fulfillment recorded at the same time",
          "fulfilled",
          { fulfilledAt: at(5) },
        ],
        [
          "a failure recorded at the same time",
          "failed",
          {
            fulfillmentFailedAt: at(5),
            fulfillmentFailureCode: fulfillmentEmailFailureCode,
          },
        ],
        [
          "an earlier failure with another code",
          "failed",
          {
            fulfillmentFailedAt: at(4),
            fulfillmentFailureCode: "provider_unavailable",
          },
        ],
      ] as const)(
        "keeps %s when a delivery failure arrives",
        async (_label, fulfillment, overrides) => {
          const id = await insertReservation(
            { payment: "paid", fulfillment },
            overrides
          );

          expect(await markDeliveryFailed(id)).toBeNull();
          expect(await readReservation(id)).toMatchObject({
            fulfillmentState: fulfillment,
            ...overrides,
          });
        }
      );

      test("recovers an email delivery failure only for a later verified delivery", async () => {
        const failed = { payment: "paid", fulfillment: "failed" } as const;
        const emailFailure = {
          fulfillmentFailedAt: at(4),
          fulfillmentFailureCode: fulfillmentEmailFailureCode,
        };
        const recoverable = await insertReservation(failed, emailFailure);
        const sameInstant = await insertReservation(failed, {
          ...emailFailure,
          fulfillmentFailedAt: at(5),
        });
        const otherFailure = await insertReservation(failed, {
          ...emailFailure,
          fulfillmentFailureCode: "provider_unavailable",
        });
        const recover = (id: WorkspaceReservationId) =>
          run((repository) =>
            repository.recoverEmailDeliveryFailure({ id, deliveredAt: at(5) })
          );

        expect((await recover(recoverable))?.id).toBe(recoverable);
        expect(await recover(sameInstant)).toBeNull();
        expect(await recover(otherFailure)).toBeNull();
        expect(await readReservation(recoverable)).toMatchObject({
          fulfillmentState: "fulfilled",
          fulfilledAt: at(5),
          fulfillmentFailedAt: at(4),
          fulfillmentFailureCode: null,
        });
        expect((await readReservation(sameInstant))?.fulfillmentState).toBe(
          "failed"
        );
        expect((await readReservation(otherFailure))?.fulfillmentState).toBe(
          "failed"
        );
      });

      test("keeps the latest failure's time through a later failure and recovery", async () => {
        const id = await insertReservation(
          { payment: "paid", fulfillment: "fulfilled" },
          { fulfilledAt: at(4), fulfillmentFailedAt: at(2) }
        );

        expect((await markDeliveryFailed(id))?.id).toBe(id);
        expect(await readReservation(id)).toMatchObject({
          fulfillmentState: "failed",
          fulfillmentFailedAt: at(5),
        });
        expect(
          (
            await run((repository) =>
              repository.recoverEmailDeliveryFailure({ id, deliveredAt: at(6) })
            )
          )?.id
        ).toBe(id);
        expect(await readReservation(id)).toMatchObject({
          fulfillmentState: "fulfilled",
          fulfilledAt: at(6),
          fulfillmentFailedAt: at(5),
        });
      });
    });

    describe("administration cancellation", () => {
      const confirmedPaid = {
        reservation: "confirmed",
        payment: "paid",
        fulfillment: "fulfilled",
      } as const;

      const claimCancellation = (
        id: WorkspaceReservationId,
        input: Partial<
          Parameters<
            typeof WorkspaceReservationRepository.Service.claimAdministrationCancellation
          >[0]
        > = {}
      ) =>
        run((repository) =>
          repository.claimAdministrationCancellation({
            id,
            providerCredentialRemoved: false,
            accessGrantUpdatedAt: null,
            staleCancellingBefore: at(10),
            ...input,
          })
        );

      test("claims a confirmed paid booking for cancellation", async () => {
        const id = await insertReservation(confirmedPaid);

        expect((await claimCancellation(id))?.id).toBe(id);
        expect((await readReservation(id))?.reservationState).toBe(
          "cancelling"
        );
      });

      test.each<readonly [string, Partial<ReservationFixtureStage>]>([
        ["payment is pending", { payment: "pending" }],
        [
          "fulfillment is processing",
          { payment: "paid", fulfillment: "processing" },
        ],
        [
          "fulfillment awaits customer delivery",
          { payment: "paid", fulfillment: "awaiting_delivery" },
        ],
        ["the booking is already cancelled", { reservation: "cancelled" }],
      ])("does not claim a cancellation while %s", async (_label, stage) => {
        const id = await insertReservation(stage);

        expect(await claimCancellation(id)).toBeNull();
        expect((await readReservation(id))?.reservationState).toBe(
          stage.reservation ?? "held"
        );
      });

      test("cancels the active pending payment attempt inside a forced payment cancellation", async () => {
        const id = await insertReservation({ payment: "pending" });
        const paymentAttemptId = await insertActivePaymentAttempt(id, {
          state: "pending",
        });
        const otherAttemptReservation = await insertReservation({
          payment: "pending",
        });
        await insertActivePaymentAttempt(otherAttemptReservation, {
          state: "pending",
        });
        const pendingPaymentCancellation = {
          paymentAttemptId,
          failureCode: "provider_abandoned",
        };

        const claimed = await claimCancellation(id, {
          pendingPaymentCancellation,
        });
        const otherAttemptClaim = await claimCancellation(
          otherAttemptReservation,
          { pendingPaymentCancellation }
        );

        expect(claimed?.id).toBe(id);
        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelling",
          paymentState: "cancelled",
          failureCode: "provider_abandoned",
        });
        expect(await readPaymentAttempt(paymentAttemptId)).toMatchObject({
          state: "cancelled",
          failureCode: "provider_abandoned",
        });
        expect(otherAttemptClaim).toBeNull();
        expect(
          (await readReservation(otherAttemptReservation))?.paymentState
        ).toBe("pending");
      });

      test("expires a live access credential only once the provider removed it", async () => {
        const id = await insertReservation(confirmedPaid);
        const grantUpdatedAt = at(2);
        await Effect.runPromise(
          testDatabase.db.insert(reservationAccessGrants).values({
            workspaceReservationId: id,
            deviceId: IgloohomeDeviceIdSchema.make("synthetic-keypad"),
            state: "issued",
            providerCredentialId: IgloohomePinIdSchema.make(
              "synthetic-credential"
            ),
            accessCode: AlgoPinSchema.make("1234567"),
            scheduledAccessStartsAt: at(0),
            accessStartsAt: at(0),
            accessEndsAt: Temporal.Instant.from("2099-01-01T00:00:00Z"),
            issuedAt: at(1),
            updatedAt: grantUpdatedAt,
          })
        );
        const readGrant = async () => {
          const [grant] = await Effect.runPromise(
            testDatabase.db
              .select()
              .from(reservationAccessGrants)
              .where(eq(reservationAccessGrants.workspaceReservationId, id))
          );
          return grant;
        };

        expect(await claimCancellation(id)).toBeNull();
        expect((await readGrant())?.state).toBe("issued");

        const claimed = await claimCancellation(id, {
          providerCredentialRemoved: true,
          accessGrantUpdatedAt: grantUpdatedAt.toString(),
        });

        expect(claimed?.id).toBe(id);
        expect(await readGrant()).toMatchObject({
          state: "expired",
          accessCode: null,
        });
      });

      test("marks the claimed revision cancelled and requires a refund of its paid Nexi attempt", async () => {
        const claimedAt = at(5);
        const id = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: claimedAt }
        );
        const nexiAttempt = await insertActivePaymentAttempt(id);
        const internalAttempt = await insertActivePaymentAttempt(id, {
          provider: "internal",
          providerOrderId: null,
          amountValue: 0,
        });

        await run((repository) =>
          repository.markAdministrationCancelled({
            id,
            cancelledAt: at(6),
            claimedAt,
            failureCode: "operator_cancelled",
          })
        );

        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelled",
          reservationCancelledAt: at(6),
          failureCode: "operator_cancelled",
        });
        expect((await readPaymentAttempt(nexiAttempt))?.refundState).toBe(
          "required"
        );
        expect((await readPaymentAttempt(internalAttempt))?.refundState).toBe(
          "not_required"
        );
      });

      test("records a cancellation failure on the claimed revision only", async () => {
        const claimedAt = at(5);
        const claimedRevision = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: claimedAt }
        );
        const laterRevision = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: at(7) }
        );
        const failure = {
          claimedAt,
          failureCode: "provider_rejected_cancellation",
        };

        await run((repository) =>
          repository.markAdministrationCancellationFailed({
            id: claimedRevision,
            ...failure,
          })
        );
        const error = await runFailure((repository) =>
          repository.markAdministrationCancellationFailed({
            id: laterRevision,
            ...failure,
          })
        );

        expect(await readReservation(claimedRevision)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "provider_rejected_cancellation",
        });
        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        expect((await readReservation(laterRevision))?.reservationState).toBe(
          "cancelling"
        );
      });

      test("refuses to mark a stale claim cancelled", async () => {
        const id = await insertReservation(
          { ...confirmedPaid, reservation: "cancelling" },
          { updatedAt: at(7) }
        );
        const attempt = await insertActivePaymentAttempt(id);

        const error = await runFailure((repository) =>
          repository.markAdministrationCancelled({
            id,
            cancelledAt: at(8),
            claimedAt: at(5),
            failureCode: "operator_cancelled",
          })
        );

        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        expect((await readReservation(id))?.reservationState).toBe(
          "cancelling"
        );
        expect((await readPaymentAttempt(attempt))?.refundState).toBe(
          "not_required"
        );
      });
    });

    describe("customer events", () => {
      const readEvents = (id: WorkspaceReservationId) =>
        Effect.runPromise(
          testDatabase.db
            .select({
              kind: customerEvents.kind,
              occurredAt: customerEvents.occurredAt,
              dotyposCustomerId: customerEvents.dotyposCustomerId,
            })
            .from(customerEvents)
            .where(eq(customerEvents.workspaceReservationId, id))
        );

      const processingPaid = {
        payment: "paid",
        fulfillment: "processing",
      } as const;

      const confirm = (id: WorkspaceReservationId) =>
        run((repository) =>
          repository.markReservationConfirmed({ id, confirmedAt: at(3) })
        );

      test("records one booked event with the confirmation, even when retried", async () => {
        const id = await insertReservation(processingPaid);
        const customerId = (await readReservation(id))?.dotyposCustomerId;

        await confirm(id);
        const retry = await runFailure((repository) =>
          repository.markReservationConfirmed({ id, confirmedAt: at(4) })
        );
        await Effect.runPromise(
          recordCustomerEvent(testDatabase.db, {
            kind: "reservation-booked",
            occurredAt: at(4),
            dotyposCustomerId: customerId!,
            workspaceReservationId: id,
          })
        );

        expect(retry).toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readEvents(id)).toEqual([
          {
            kind: "reservation-booked",
            occurredAt: at(3),
            dotyposCustomerId: customerId!,
          },
        ]);
      });

      test("rolls the confirmation back with a failed event write", async () => {
        const id = await insertReservation(processingPaid);
        const cleanup = await rejectCustomerEventInserts(
          testDatabase.pool,
          `new.workspace_reservation_id = '${id}'`
        );
        const failure = await runFailure((repository) =>
          repository.markReservationConfirmed({ id, confirmedAt: at(3) })
        ).finally(cleanup);

        expect(failure).not.toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readReservation(id)).toMatchObject({
          reservationState: "held",
          reservationConfirmedAt: null,
        });
        expect(await readEvents(id)).toEqual([]);
      });

      test("records a cancelled event only for an administration cancellation of a confirmed booking", async () => {
        const claimedAt = at(5);
        const cancelling = {
          reservation: "cancelling",
          payment: "paid",
          fulfillment: "fulfilled",
        } as const;
        const confirmed = await insertReservation(cancelling, {
          updatedAt: claimedAt,
          reservationConfirmedAt: at(1),
        });
        const unconfirmed = await insertReservation(cancelling, {
          updatedAt: claimedAt,
        });
        const cancel = (id: WorkspaceReservationId) =>
          run((repository) =>
            repository.markAdministrationCancelled({
              id,
              cancelledAt: at(6),
              claimedAt,
              failureCode: "operator_cancelled",
            })
          );

        await cancel(confirmed);
        await cancel(unconfirmed);

        expect(await readEvents(confirmed)).toEqual([
          {
            kind: "reservation-cancelled",
            occurredAt: at(6),
            dotyposCustomerId: (await readReservation(confirmed))!
              .dotyposCustomerId,
          },
        ]);
        expect(await readEvents(unconfirmed)).toEqual([]);
      });

      test("rolls the administration cancellation back with a failed event write", async () => {
        const claimedAt = at(5);
        const id = await insertReservation(
          {
            reservation: "cancelling",
            payment: "paid",
            fulfillment: "fulfilled",
          },
          { updatedAt: claimedAt, reservationConfirmedAt: at(1) }
        );
        const cleanup = await rejectCustomerEventInserts(
          testDatabase.pool,
          `new.workspace_reservation_id = '${id}'`
        );
        const failure = await runFailure((repository) =>
          repository.markAdministrationCancelled({
            id,
            cancelledAt: at(6),
            claimedAt,
            failureCode: "operator_cancelled",
          })
        ).finally(cleanup);

        expect(failure).not.toBeInstanceOf(WorkspaceReservationStateError);
        expect(await readReservation(id)).toMatchObject({
          reservationState: "cancelling",
          reservationCancelledAt: null,
        });
        expect(await readEvents(id)).toEqual([]);
      });

      test("records nothing for an unpaid cancellation or a supersession", async () => {
        const unpaid = await insertReservation({ reservation: "cancelling" });
        const superseded = await insertReservation({
          reservation: "cancelling",
          payment: "failed",
        });
        const replacementKey = crypto.randomUUID();

        await run((repository) =>
          repository.markCancelled({ id: unpaid, cancelledAt: at(2) })
        );
        const replacement = await run((repository) =>
          repository.completeSupersessionAndCreateDraft({
            cancelledReservationId: superseded,
            cancelledAt: at(2),
            replacement: {
              checkoutSessionKey: checkoutSessionKeySchema.make(
                `session-${replacementKey}`
              ),
              checkoutAttemptKey: checkoutAttemptKeySchema.make(
                `attempt-${replacementKey}`
              ),
              dotyposCustomerId: DotyposCustomerIdSchema.make(
                `customer-${replacementKey}`
              ),
              authorAccountId: fixtureReservationAuthorId,
              reservationPurpose: "personal",
              reservationDetails: {
                kind: "cowork",
                entryTier: "basic",
                coffee: false,
              },
              locale: "en-US",
            },
          })
        );
        reservationIds.push(replacement.id);

        expect((await readReservation(unpaid))?.reservationState).toBe(
          "cancelled"
        );
        expect((await readReservation(superseded))?.reservationState).toBe(
          "cancelled"
        );
        for (const id of [unpaid, superseded, replacement.id]) {
          expect(await readEvents(id)).toEqual([]);
        }
      });
    });
  }
);
