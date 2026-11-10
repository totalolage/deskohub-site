import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  type DotyposReservationId,
  DotyposReservationIdSchema,
  type DotyposReservationStatus,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { eq, inArray } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { workspaceReservations } from "@/db/schema";
import {
  type IWorkspaceReservationRepository,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  type ReservationFixtureInput,
  workspaceFixtures,
} from "@/shared/testing/workspace-fixtures.test-utils";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  UnpaidHoldRelease,
  type UnpaidHoldReleaseRequest,
} from "./unpaid-hold-release.service";

const postgresDatabase = await connectWorkspacePostgresTestDatabase();

const dotyposUnavailable = (operation: string) =>
  new DotyposUnavailable({ operation, reason: "server" });

describe.skipIf(!postgresDatabase)(
  "UnpaidHoldRelease.release on Postgres",
  () => {
    const postgres = postgresDatabase as WorkspacePostgresTestDatabase;
    const created: WorkspaceReservationId[] = [];

    afterEach(async () => {
      if (created.length === 0) return;
      await postgres.db
        .delete(workspaceReservations)
        .where(inArray(workspaceReservations.id, created))
        .pipe(Effect.runPromise);
      created.length = 0;
    });

    const reservationsLayer = () =>
      WorkspaceReservationRepository.Default.pipe(
        Layer.provide(postgres.layer)
      );

    /** Runs an operation of another run against the same database. */
    const elsewhere = <A, E>(
      operation: (
        reservations: IWorkspaceReservationRepository
      ) => Effect.Effect<A, E>
    ) =>
      WorkspaceReservationRepository.pipe(
        Effect.flatMap(operation),
        Effect.provide(reservationsLayer())
      );

    const newReservation = async (input: ReservationFixtureInput) => {
      const row = await workspaceFixtures(postgres.db)
        .reservation(input)
        .pipe(Effect.runPromise);
      created.push(row.id);
      return row;
    };

    const rowOf = async (id: WorkspaceReservationId) => {
      const [row] = await postgres.db
        .select()
        .from(workspaceReservations)
        .where(eq(workspaceReservations.id, id))
        .pipe(Effect.runPromise);
      return row!;
    };

    const stateOf = (id: WorkspaceReservationId) =>
      Effect.promise(() => rowOf(id)).pipe(
        Effect.map((row) => row.reservationState)
      );

    /**
     * Dotypos behind its service mock. Each hold reads as `status`, and each
     * call records the reservation's local state when it was made, so a test
     * sees where the call fell relative to the claim.
     */
    const makeDotypos = (
      reservationId: WorkspaceReservationId,
      status: DotyposReservationStatus = "NEW"
    ) => {
      const calls: string[] = [];
      const getReservationStatus = mock((_id: DotyposReservationId) =>
        stateOf(reservationId).pipe(
          Effect.tap((state) =>
            Effect.sync(() => calls.push(`getReservationStatus while ${state}`))
          ),
          Effect.as<DotyposReservationStatus>(status)
        )
      );
      const cancelReservation = mock((_id: DotyposReservationId) =>
        stateOf(reservationId).pipe(
          Effect.tap((state) =>
            Effect.sync(() => calls.push(`cancelReservation while ${state}`))
          ),
          Effect.asVoid
        )
      );
      return { calls, getReservationStatus, cancelReservation };
    };
    type Dotypos = ReturnType<typeof makeDotypos>;

    const release = (request: UnpaidHoldReleaseRequest, dotypos: Dotypos) =>
      UnpaidHoldRelease.pipe(
        Effect.flatMap((holds) => holds.release(request)),
        Effect.provide(
          UnpaidHoldRelease.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                reservationsLayer(),
                Layer.mock(DotyposService, {
                  getReservationStatus: dotypos.getReservationStatus as never,
                  cancelReservation: dotypos.cancelReservation as never,
                })
              )
            )
          )
        ),
        Effect.result,
        Effect.runPromise
      );

    const heldHold = () => newReservation({ stage: { reservation: "held" } });

    /** A late payment's release of the hold the reservation names. */
    const latePayment = (hold: {
      readonly id: WorkspaceReservationId;
      readonly dotyposReservationId: DotyposReservationId | null;
    }): UnpaidHoldReleaseRequest => ({
      reason: "late_payment",
      reservationId: hold.id,
      originalDotyposReservationId: hold.dotyposReservationId!,
    });

    describe("for an expired hold", () => {
      const holdExpiredAt = Temporal.Instant.from("2026-07-01T08:00:00Z");

      test("claims the hold, cancels it in Dotypos without reading its status and records the expiry", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(
          { reason: "hold_expired", reservationId: hold.id, holdExpiredAt },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: {
            released: { id: hold.id, reservationState: "cancelling" },
          },
        });
        expect(dotypos.calls).toEqual(["cancelReservation while cancelling"]);
        expect(dotypos.cancelReservation).toHaveBeenCalledWith(
          hold.dotyposReservationId
        );
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancelled",
          reservationHoldExpiredAt: holdExpiredAt,
        });
      });

      test("finishes a cancellation another run claimed", async () => {
        const hold = await newReservation({
          stage: { reservation: "cancelling" },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(
          { reason: "hold_expired", reservationId: hold.id, holdExpiredAt },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { released: { id: hold.id } },
        });
        expect(dotypos.calls).toEqual(["cancelReservation while cancelling"]);
        expect((await rowOf(hold.id)).reservationState).toBe("cancelled");
      });

      test("leaves a paid hold alone", async () => {
        const hold = await newReservation({
          stage: { reservation: "held", payment: "paid" },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(
          { reason: "hold_expired", reservationId: hold.id, holdExpiredAt },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "unreleasable",
        });
        expect(dotypos.calls).toEqual([]);
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "held",
          updatedAt: hold.updatedAt,
        });
      });

      test("marks the cancellation failed when Dotypos can't cancel the hold", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.cancelReservation.mockImplementationOnce(() =>
          Effect.fail(dotyposUnavailable("cancelReservation"))
        );

        const outcome = await release(
          { reason: "hold_expired", reservationId: hold.id, holdExpiredAt },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposUnavailable" },
        });
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "dotypos_cancel_failed",
        });
      });

      test("reports a changed state when another run finished the cancellation first", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.cancelReservation.mockImplementationOnce(() =>
          elsewhere((reservations) =>
            reservations.markCancelled({
              id: hold.id,
              cancelledAt: Temporal.Now.instant(),
            })
          ).pipe(Effect.orDie)
        );

        const outcome = await release(
          { reason: "hold_expired", reservationId: hold.id, holdExpiredAt },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "state_changed",
        });
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancelled",
          reservationHoldExpiredAt: null,
        });
      });
    });

    describe("for a late payment", () => {
      test("reads the live status before the claim, then cancels a NEW hold", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id, "NEW");

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { released: { id: hold.id } },
        });
        expect(dotypos.calls).toEqual([
          "getReservationStatus while held",
          "cancelReservation while cancelling",
        ]);
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancelled",
          reservationHoldExpiredAt: null,
        });
      });

      test("records a cancellation Dotypos already made without cancelling again", async () => {
        const hold = await newReservation({
          stage: { reservation: "cancellation_failed" },
          overrides: { failureCode: "dotypos_cancel_failed" },
        });
        const dotypos = makeDotypos(hold.id, "CANCELLED");

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { released: { id: hold.id } },
        });
        expect(dotypos.calls).toEqual([
          "getReservationStatus while cancellation_failed",
        ]);
        expect((await rowOf(hold.id)).reservationState).toBe("cancelled");
      });

      test("refuses a hold Dotypos confirmed without claiming it", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id, "CONFIRMED");

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { refused: "CONFIRMED" },
        });
        expect(dotypos.calls).toEqual(["getReservationStatus while held"]);
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "held",
          updatedAt: hold.updatedAt,
        });
      });

      test("leaves the hold untouched when its status can't be read", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.getReservationStatus.mockImplementationOnce(() =>
          Effect.fail(dotyposUnavailable("getReservationStatus"))
        );

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposUnavailable" },
        });
        expect(dotypos.cancelReservation).not.toHaveBeenCalled();
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "held",
          updatedAt: hold.updatedAt,
        });
      });

      test("marks the cancellation failed when Dotypos can't cancel the hold", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.cancelReservation.mockImplementationOnce(() =>
          Effect.fail(dotyposUnavailable("cancelReservation"))
        );

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DotyposUnavailable" },
        });
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "dotypos_cancel_failed",
        });
      });

      test("waits out a fresh cancellation another run owns", async () => {
        const hold = await newReservation({
          stage: { reservation: "cancelling" },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "in_progress",
        });
        expect(dotypos.calls).toEqual([]);
        expect((await rowOf(hold.id)).reservationState).toBe("cancelling");
      });

      test("finishes a stale cancellation an interrupted run left", async () => {
        const hold = await newReservation({
          stage: { reservation: "cancelling" },
          overrides: {
            updatedAt: Temporal.Now.instant().subtract({ hours: 1 }),
          },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { released: { id: hold.id } },
        });
        expect(dotypos.calls).toEqual([
          "getReservationStatus while cancelling",
          "cancelReservation while cancelling",
        ]);
        expect((await rowOf(hold.id)).reservationState).toBe("cancelled");
      });

      test("reports a reservation that is already cancelled as released", async () => {
        const hold = await newReservation({
          stage: { reservation: "cancelled" },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "already_released",
        });
        expect(dotypos.calls).toEqual([]);
      });

      test("leaves a confirmed reservation alone", async () => {
        const hold = await newReservation({
          stage: { reservation: "confirmed", payment: "paid" },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "unreleasable",
        });
        expect(dotypos.calls).toEqual([]);
        expect((await rowOf(hold.id)).reservationState).toBe("confirmed");
      });

      test("leaves a hold another run claimed after the status read", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.getReservationStatus.mockImplementationOnce(() =>
          elsewhere((reservations) =>
            reservations.claimCancellation(hold.id)
          ).pipe(Effect.orDie, Effect.as("NEW" as const))
        );

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "unclaimed",
        });
        expect(dotypos.cancelReservation).not.toHaveBeenCalled();
        expect((await rowOf(hold.id)).reservationState).toBe("cancelling");
      });

      test("accepts a cancellation another run finished first", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.cancelReservation.mockImplementationOnce(() =>
          elsewhere((reservations) =>
            reservations.markCancelled({
              id: hold.id,
              cancelledAt: Temporal.Now.instant(),
            })
          ).pipe(Effect.orDie)
        );

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "already_released",
        });
        expect((await rowOf(hold.id)).reservationState).toBe("cancelled");
      });

      test("releases the original hold after another recovery settled a replacement on the reservation", async () => {
        // Another recovery resumed a held replacement and settled it: the
        // reservation now names the replacement's hold and is paid.
        const settled = await newReservation({
          stage: { reservation: "held", payment: "paid" },
        });
        const replacementId = settled.dotyposReservationId!;
        const originalDotyposReservationId = DotyposReservationIdSchema.make(
          `original-hold-${crypto.randomUUID()}`
        );
        const dotypos = makeDotypos(settled.id);
        dotypos.getReservationStatus.mockImplementation((id) =>
          Effect.succeed(id === replacementId ? "CONFIRMED" : "CANCELLED")
        );

        const outcome = await release(
          {
            reason: "late_payment",
            reservationId: settled.id,
            originalDotyposReservationId,
          },
          dotypos
        );

        // The original hold reads cancelled, and the paid reservation can't
        // be claimed, so the stale run leaves both holds alone.
        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "unclaimed",
        });
        expect(dotypos.getReservationStatus.mock.calls).toEqual([
          [originalDotyposReservationId],
        ]);
        expect(dotypos.cancelReservation).not.toHaveBeenCalled();
        expect(await rowOf(settled.id)).toMatchObject({
          reservationState: "held",
          paymentState: "paid",
          dotyposReservationId: replacementId,
          updatedAt: settled.updatedAt,
        });
      });

      test("fails when another run left the claimed hold in another state", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.cancelReservation.mockImplementationOnce(() =>
          elsewhere((reservations) =>
            reservations.markCancellationFailed({
              id: hold.id,
              failureCode: "dotypos_cancel_failed",
            })
          ).pipe(Effect.orDie)
        );

        const outcome = await release(latePayment(hold), dotypos);

        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "WorkspaceReservationStateError" },
        });
        expect((await rowOf(hold.id)).reservationState).toBe(
          "cancellation_failed"
        );
      });
    });

    describe("for an agent's rotated hold", () => {
      test("claims the hold, then cancels it once Dotypos reports it NEW", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id, "NEW");

        const outcome = await release(
          { reason: "agent_rotated", reservationId: hold.id },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { released: { id: hold.id } },
        });
        expect(dotypos.calls).toEqual([
          "getReservationStatus while cancelling",
          "cancelReservation while cancelling",
        ]);
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancelled",
          reservationHoldExpiredAt: null,
        });
      });

      test("records a cancellation Dotypos already made without cancelling again", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id, "CANCELLED");

        const outcome = await release(
          { reason: "agent_rotated", reservationId: hold.id },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { released: { id: hold.id } },
        });
        expect(dotypos.calls).toEqual([
          "getReservationStatus while cancelling",
        ]);
        expect((await rowOf(hold.id)).reservationState).toBe("cancelled");
      });

      test("refuses a hold Dotypos confirmed and marks its cancellation failed", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id, "CONFIRMED");

        const outcome = await release(
          { reason: "agent_rotated", reservationId: hold.id },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: { refused: "CONFIRMED" },
        });
        expect(dotypos.cancelReservation).not.toHaveBeenCalled();
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: "checkout_supersession_cancel_failed",
        });
      });

      test.each([
        ["its status can't be read", "getReservationStatus"],
        ["Dotypos can't cancel it", "cancelReservation"],
      ] as const)(
        "marks the cancellation failed when %s",
        async (_, operation) => {
          const hold = await heldHold();
          const dotypos = makeDotypos(hold.id);
          dotypos[operation].mockImplementationOnce(() =>
            Effect.fail(dotyposUnavailable(operation))
          );

          const outcome = await release(
            { reason: "agent_rotated", reservationId: hold.id },
            dotypos
          );

          expect(outcome).toMatchObject({
            _tag: "Failure",
            failure: { _tag: "DotyposUnavailable" },
          });
          expect(await rowOf(hold.id)).toMatchObject({
            reservationState: "cancellation_failed",
            failureCode: "checkout_supersession_cancel_failed",
          });
        }
      );

      test("leaves a hold whose payment started", async () => {
        const hold = await newReservation({
          stage: { reservation: "held", payment: "pending" },
        });
        const dotypos = makeDotypos(hold.id);

        const outcome = await release(
          { reason: "agent_rotated", reservationId: hold.id },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Success",
          success: "unclaimed",
        });
        expect(dotypos.calls).toEqual([]);
        expect(await rowOf(hold.id)).toMatchObject({
          reservationState: "held",
          updatedAt: hold.updatedAt,
        });
      });

      test("fails when another run finished the cancellation first", async () => {
        const hold = await heldHold();
        const dotypos = makeDotypos(hold.id);
        dotypos.cancelReservation.mockImplementationOnce(() =>
          elsewhere((reservations) =>
            reservations.markCancelled({
              id: hold.id,
              cancelledAt: Temporal.Now.instant(),
            })
          ).pipe(Effect.orDie)
        );

        const outcome = await release(
          { reason: "agent_rotated", reservationId: hold.id },
          dotypos
        );

        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "WorkspaceReservationStateError" },
        });
        expect((await rowOf(hold.id)).reservationState).toBe("cancelled");
      });
    });
  }
);
