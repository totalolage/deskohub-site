import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  DotyposRejected,
  DotyposService,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";

mock.module("server-only", () => ({}));

const { DotyposHoldRelease } = await import("./dotypos-hold-release.service");
const { WorkspaceReservationRepository } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);

type Methods = Record<
  string,
  (...args: never[]) => Effect.Effect<unknown, unknown>
>;

const succeed =
  <A>(value: A) =>
  () =>
    Effect.succeed(value as never);
const fail =
  <E>(error: E) =>
  () =>
    Effect.fail(error as never);

const statusReadUnavailable = new DotyposUnavailable({
  operation: "getReservationStatus",
  reason: "timeout",
});
const cancelUnavailable = new DotyposUnavailable({
  operation: "cancelReservation",
  reason: "timeout",
});

const release = async (input: {
  readonly liveStatus: "require_new" | "unchecked";
  readonly failureCode?:
    | "dotypos_cancel_failed"
    | "checkout_supersession_cancel_failed";
  readonly reservations?: Methods;
  readonly dotypos?: Methods;
}) => {
  const trace: EffectTrace = startEffectTrace();
  const exit = await Effect.gen(function* () {
    const holdRelease = yield* DotyposHoldRelease;
    return yield* recordEffectTrace(
      trace,
      holdRelease.release({
        reservationId: "reservation-id" as never,
        dotyposReservationId: "dotypos-reservation-id" as never,
        liveStatus: input.liveStatus,
        failureCode: input.failureCode ?? "dotypos_cancel_failed",
      })
    );
  }).pipe(
    Effect.provide(
      DotyposHoldRelease.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              WorkspaceReservationRepository,
              trace.recordCalls("reservations", {
                markCancellationFailed: succeed(undefined),
                ...input.reservations,
              })
            ),
            Layer.mock(
              DotyposService,
              trace.recordCalls("dotypos", {
                getReservationStatus: succeed("NEW"),
                cancelReservation: succeed(undefined),
                ...input.dotypos,
              })
            )
          )
        )
      )
    ),
    Effect.runPromise
  );
  return {
    outcome: Exit.isSuccess(exit) ? exit.value : Cause.squash(exit.cause),
    trace: trace.entries,
  };
};

describe("DotyposHoldRelease.release", () => {
  test("cancels without reading the live status when the rule leaves it unchecked", async () => {
    const { outcome, trace } = await release({ liveStatus: "unchecked" });

    expect(outcome).toBe("cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
      ]
    `);
  });

  test("cancels a hold Dotypos still keeps NEW", async () => {
    const { outcome, trace } = await release({ liveStatus: "require_new" });

    expect(outcome).toBe("cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
      ]
    `);
  });

  test("takes a hold Dotypos already cancelled as released", async () => {
    const { outcome, trace } = await release({
      liveStatus: "require_new",
      dotypos: { getReservationStatus: succeed("CANCELLED") },
    });

    expect(outcome).toBe("already_cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
      ]
    `);
  });

  test("refuses and marks a hold whose live status isn't NEW", async () => {
    const { outcome, trace } = await release({
      liveStatus: "require_new",
      failureCode: "checkout_supersession_cancel_failed",
      dotypos: { getReservationStatus: succeed("CONFIRMED") },
    });

    expect(outcome).toEqual({ refused: "CONFIRMED" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.markCancellationFailed(id=reservation-id, failureCode=checkout_supersession_cancel_failed)",
      ]
    `);
  });

  test("marks the reservation and keeps the failure when the live status can't be read", async () => {
    const { outcome, trace } = await release({
      liveStatus: "require_new",
      failureCode: "checkout_supersession_cancel_failed",
      dotypos: { getReservationStatus: fail(statusReadUnavailable) },
    });

    expect(outcome).toBe(statusReadUnavailable);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.markCancellationFailed(id=reservation-id, failureCode=checkout_supersession_cancel_failed)",
      ]
    `);
  });

  test("marks the reservation and keeps the failure when Dotypos can't cancel", async () => {
    const { outcome, trace } = await release({
      liveStatus: "unchecked",
      dotypos: { cancelReservation: fail(cancelUnavailable) },
    });

    expect(outcome).toBe(cancelUnavailable);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancellationFailed(id=reservation-id, failureCode=dotypos_cancel_failed)",
      ]
    `);
  });

  test("keeps the Dotypos failure when the failure marker fails too", async () => {
    const { outcome, trace } = await release({
      liveStatus: "require_new",
      reservations: { markCancellationFailed: fail(new Error("db down")) },
      dotypos: {
        cancelReservation: fail(
          new DotyposRejected({
            operation: "cancelReservation",
            reason: "not-found",
          })
        ),
      },
    });

    expect(outcome).toBeInstanceOf(DotyposRejected);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span dotyposHoldRelease.release",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancellationFailed(id=reservation-id, failureCode=dotypos_cancel_failed)",
        "Error Reservation cancellation failure marker failed (orderId=reservation-id, failureCode=dotypos_cancel_failed, cause=<Error>) {} in dotyposHoldRelease.release",
      ]
    `);
  });
});
