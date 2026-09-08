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

type ReservationRow = Parameters<
  WorkspaceE2ELocalReservationTransaction["insertReservation"]
>[0];

const makeFakeDatabase = (
  options: { readonly failVerificationRead?: boolean } = {}
) => {
  const reservations = new Map<string, ReservationRow>();
  const rollback = (snapshot: Map<string, ReservationRow>) => {
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
        insertReservation: (row: ReservationRow) =>
          Effect.sync(() => {
            if (!row.id) throw new Error("local reservation id missing");
            reservations.set(row.id, row);
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
            const row = fake.reservations.get(value.reservationId);
            expect(row).toBeDefined();
            if (!row) return yield* Effect.fail(new Error("row missing"));

            expect(row.checkoutAttemptKey).toBe(value.checkoutAttemptKey);
            expect(row.checkoutSessionKey).toBe(value.checkoutSessionKey);
            expect(row.dotyposCustomerId).toBe(value.customerId);
            expect(row.dotyposReservationId).toBeNull();
            expect(row.activePaymentAttemptId).toBeNull();
            expect(row.reservationState).toBe("hold_expired");
            expect(row.paymentState).toBe("expired");
            expect(row.fulfillmentState).toBe("not_started");
            expect(row.locale).toBe("en-US");
            expect(row.reservationDetails).toEqual({
              coffee: false,
              entryTier: "basic",
              kind: "cowork",
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
