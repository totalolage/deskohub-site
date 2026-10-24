import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  seedWorkspaceE2ELocalReservation,
  type WorkspaceE2ELocalReservationDatabase,
  type WorkspaceE2ELocalReservationFixture,
  type WorkspaceE2ELocalReservationTransaction,
  withWorkspaceE2ELocalReservationFixture,
} from "./local-reservation-fixture";

type Reservation = Parameters<
  WorkspaceE2ELocalReservationTransaction["insertReservation"]
>[0];

const makeFakeDatabase = (
  options: { readonly failVerificationRead?: boolean } = {}
) => {
  const reservations = new Map<string, Reservation>();
  const rollback = (snapshot: Map<string, Reservation>) => {
    reservations.clear();
    for (const [id, row] of snapshot) reservations.set(id, row);
  };
  const database: WorkspaceE2ELocalReservationDatabase = {
    deleteReservation: (id) =>
      Effect.sync(() => {
        reservations.delete(id);
      }),
    findReservation: (id) =>
      Effect.sync(() => (reservations.has(id) ? [{ id }] : [])),
    transaction: (use) => {
      const snapshot = new Map(reservations);
      const transaction = {
        findReservation: (id: WorkspaceReservationId) =>
          options.failVerificationRead
            ? Effect.fail(new Error("verification read failed"))
            : Effect.sync(() => (reservations.has(id) ? [{ id }] : [])),
        insertReservation: (reservation: Reservation) =>
          Effect.sync(() => {
            const id = reservation.overrides?.id;
            if (!id) throw new Error("local reservation id missing");
            reservations.set(id, reservation);
          }),
      };
      return use(transaction).pipe(
        Effect.onExit((exit) =>
          Exit.isSuccess(exit)
            ? Effect.void
            : Effect.sync(() => rollback(snapshot))
        )
      );
    },
  };

  return { database, reservations };
};

test("rolls back the inserted row when seed verification cannot read it", async () => {
  const fake = makeFakeDatabase({ failVerificationRead: true });

  await expect(
    Effect.runPromise(
      seedWorkspaceE2ELocalReservation({ database: fake.database })
    )
  ).rejects.toThrow("verification read failed");

  expect(fake.reservations.size).toBe(0);
});

test("seeds one terminal local row and removes exactly that row in the finalizer", async () => {
  const fake = makeFakeDatabase();
  let fixture: WorkspaceE2ELocalReservationFixture | undefined;

  await expect(
    Effect.runPromise(
      withWorkspaceE2ELocalReservationFixture(
        (value) =>
          Effect.gen(function* () {
            fixture = value;
            const reservation = fake.reservations.get(value.reservationId);
            expect(reservation).toBeDefined();
            if (!reservation) {
              return yield* Effect.fail(new Error("reservation missing"));
            }

            expect(reservation.overrides?.checkoutAttemptKey).toBe(
              value.checkoutAttemptKey
            );
            expect(reservation.overrides?.checkoutSessionKey).toBe(
              value.checkoutSessionKey
            );
            expect(reservation.customer).toBe(value.customerId);
            expect(reservation.stage).toEqual({
              reservation: "hold_expired",
              payment: "expired",
            });
            return yield* Effect.fail(new Error("exercise finalizer"));
          }),
        { database: fake.database }
      )
    )
  ).rejects.toThrow("exercise finalizer");

  expect(fixture).toBeDefined();
  expect(fake.reservations.size).toBe(0);
});
