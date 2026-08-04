import { expect, mock, test } from "bun:test";
import type { Customer, Reservation } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import {
  isWorkspaceE2ETestCustomer,
  reconcileStaleWorkspaceE2EReservations,
} from "./stale-reservations";

const interval = {
  endDate: new Date("2099-09-01T00:00:00.000Z"),
  startDate: new Date("2099-08-01T00:00:00.000Z"),
};

test("requires both Workspace E2E customer markers", () => {
  expect(isWorkspaceE2ETestCustomer(customer())).toBe(true);
  expect(
    isWorkspaceE2ETestCustomer(customer({ email: "person@example.com" }))
  ).toBe(false);
  expect(
    isWorkspaceE2ETestCustomer(customer({ firstName: "Ordinary customer" }))
  ).toBe(false);
  expect(
    isWorkspaceE2ETestCustomer(
      customer({ email: "delivered+case@example.com" })
    )
  ).toBe(false);
});

test("overlaps every detail read and retains all read failures", async () => {
  const readBarrier = makeBarrier(3);
  const cancelReservation = mock(() => Effect.void);
  const report = await Effect.runPromise(
    reconcileStaleWorkspaceE2EReservations(interval, true, {
      cancelReservation,
      listActiveReservations: () =>
        Effect.succeed([
          reservation("reservation-1"),
          reservation("reservation-2"),
          reservation("reservation-3"),
        ]),
      loadReservation: (reservationId) =>
        readBarrier.wait().pipe(
          Effect.flatMap(() =>
            reservationId === "reservation-2"
              ? Effect.fail(new Error("detail read failed"))
              : Effect.succeed({
                  customer: customer(),
                  reservation: reservation(reservationId),
                })
          )
        ),
      waitForCancellationConvergence: () => Effect.void,
    })
  );

  expect(readBarrier.maximumActive()).toBe(3);
  expect(report).toEqual({
    activeCandidateCount: 3,
    cancellationAttemptCount: 0,
    cancellationConverged: null,
    cancellationFailureCount: 0,
    detailReadFailureCount: 1,
    identifiedStaleE2ECount: 2,
  });
  expect(cancelReservation).not.toHaveBeenCalled();
});

test("overlaps independent cancellations and retains every failure", async () => {
  const cancellationBarrier = makeBarrier(3);
  const waitForCancellationConvergence = mock(() => Effect.void);
  const report = await Effect.runPromise(
    reconcileStaleWorkspaceE2EReservations(interval, true, {
      cancelReservation: (reservationId) =>
        cancellationBarrier.wait().pipe(
          Effect.flatMap(() =>
            reservationId === "reservation-2"
              ? Effect.fail(new Error("cancellation failed"))
              : Effect.void
          )
        ),
      listActiveReservations: () =>
        Effect.succeed([
          reservation("reservation-1"),
          reservation("reservation-2"),
          reservation("reservation-3"),
        ]),
      loadReservation: (reservationId) =>
        Effect.succeed({
          customer: customer(),
          reservation: reservation(reservationId),
        }),
      waitForCancellationConvergence,
    })
  );

  expect(cancellationBarrier.maximumActive()).toBe(3);
  expect(report).toEqual({
    activeCandidateCount: 3,
    cancellationAttemptCount: 3,
    cancellationConverged: false,
    cancellationFailureCount: 1,
    detailReadFailureCount: 0,
    identifiedStaleE2ECount: 3,
  });
  expect(waitForCancellationConvergence).not.toHaveBeenCalled();
});

test("waits for successful cancellation convergence", async () => {
  const waitForCancellationConvergence = mock(() => Effect.void);
  const report = await Effect.runPromise(
    reconcileStaleWorkspaceE2EReservations(interval, true, {
      cancelReservation: () => Effect.void,
      listActiveReservations: () =>
        Effect.succeed([reservation("reservation-1")]),
      loadReservation: (reservationId) =>
        Effect.succeed({
          customer: customer(),
          reservation: reservation(reservationId),
        }),
      waitForCancellationConvergence,
    })
  );

  expect(report.cancellationConverged).toBe(true);
  expect(waitForCancellationConvergence).toHaveBeenCalledTimes(1);
});

const customer = (overrides: Partial<Customer> = {}): Customer => ({
  _cloudId: "testing-cloud",
  deleted: false,
  display: true,
  email: "DELIVERED+case@resend.dev",
  firstName: "Workspace E2E checkout",
  flags: "0",
  lastName: "run 1",
  points: "0",
  ...overrides,
});

const reservation = (id: string): Reservation => ({
  _branchId: "testing-branch",
  _cloudId: "testing-cloud",
  endDate: "2099-08-03T18:00:00+00:00",
  id,
  seats: "1",
  startDate: "2099-08-03T08:00:00+00:00",
  status: "CONFIRMED",
});

const makeBarrier = (expectedParticipants: number) => {
  let active = 0;
  let maximumActive = 0;
  let started = 0;
  let release: () => void = () => undefined;
  const allStarted = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    maximumActive: () => maximumActive,
    wait: () =>
      Effect.acquireUseRelease(
        Effect.sync(() => {
          active += 1;
          started += 1;
          maximumActive = Math.max(maximumActive, active);
          if (started === expectedParticipants) release();
        }),
        () => Effect.promise(() => allStarted),
        () =>
          Effect.sync(() => {
            active -= 1;
          })
      ),
  };
};
