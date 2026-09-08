import { expect, test } from "bun:test";
import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import { floorToWholeHour } from "@/shared/utils/temporal";
import type { DatasourceConfig } from "../config";
import {
  seedWorkspaceE2EReservationHistory,
  type WorkspaceE2EReservationHistoryDatabase,
  type WorkspaceE2EReservationHistoryFixture,
  type WorkspaceE2EReservationHistoryFixtureInput,
  type WorkspaceE2EReservationHistoryFixtureTestDependencies,
  type WorkspaceE2EReservationHistoryProviderProjection,
  withWorkspaceE2EReservationHistoryFixture,
} from "./reservation-history-fixture";

type FixtureRows = Parameters<
  WorkspaceE2EReservationHistoryDatabase["transaction"]
>[0];

type FakeDatabase = {
  readonly accessGrants: Map<string, FixtureRows["accessGrant"]>;
  readonly cleanupCalls: Array<{ readonly id: string; readonly table: string }>;
  readonly database: WorkspaceE2EReservationHistoryDatabase;
  readonly paymentAttempts: Map<string, FixtureRows["paymentAttempt"]>;
  readonly reservations: Map<string, FixtureRows["reservation"]>;
  readonly transactionCalls: FixtureRows[];
  readonly verificationCalls: Array<{
    readonly id: string;
    readonly table: string;
  }>;
};

const makeFakeDatabase = (
  options: { readonly failTransaction?: boolean } = {}
) => {
  const accessGrants = new Map<string, FixtureRows["accessGrant"]>();
  const paymentAttempts = new Map<string, FixtureRows["paymentAttempt"]>();
  const reservations = new Map<string, FixtureRows["reservation"]>();
  const cleanupCalls: Array<{ readonly id: string; readonly table: string }> =
    [];
  const transactionCalls: FixtureRows[] = [];
  const verificationCalls: Array<{
    readonly id: string;
    readonly table: string;
  }> = [];

  const restore = (
    snapshot: Readonly<{
      readonly accessGrants: Map<string, FixtureRows["accessGrant"]>;
      readonly paymentAttempts: Map<string, FixtureRows["paymentAttempt"]>;
      readonly reservations: Map<string, FixtureRows["reservation"]>;
    }>
  ) => {
    accessGrants.clear();
    paymentAttempts.clear();
    reservations.clear();
    for (const [id, row] of snapshot.accessGrants) accessGrants.set(id, row);
    for (const [id, row] of snapshot.paymentAttempts)
      paymentAttempts.set(id, row);
    for (const [id, row] of snapshot.reservations) reservations.set(id, row);
  };

  const database: WorkspaceE2EReservationHistoryDatabase = {
    deleteAccessGrant: (id) =>
      Effect.sync(() => {
        cleanupCalls.push({ id, table: "reservation_access_grants" });
        accessGrants.delete(id);
      }),
    deleteReservation: (id) =>
      Effect.sync(() => {
        cleanupCalls.push({ id, table: "workspace_reservations" });
        reservations.delete(id);
        for (const [paymentAttemptId, row] of paymentAttempts) {
          if (row.workspaceReservationId === id)
            paymentAttempts.delete(paymentAttemptId);
        }
      }),
    findAccessGrant: (id) =>
      Effect.sync(() => {
        verificationCalls.push({ id, table: "reservation_access_grants" });
        return accessGrants.has(id) ? [{ id }] : [];
      }),
    findPaymentAttempt: (id) =>
      Effect.sync(() => {
        verificationCalls.push({ id, table: "payment_attempts" });
        return paymentAttempts.has(id) ? [{ id }] : [];
      }),
    findReservation: (id) =>
      Effect.sync(() => {
        verificationCalls.push({ id, table: "workspace_reservations" });
        return reservations.has(id) ? [{ id }] : [];
      }),
    transaction: (rows) =>
      Effect.gen(function* () {
        transactionCalls.push(rows);
        const snapshot = {
          accessGrants: new Map(accessGrants),
          paymentAttempts: new Map(paymentAttempts),
          reservations: new Map(reservations),
        };
        const reservationId = rows.reservation.id;
        const paymentAttemptId = rows.paymentAttempt.id;
        const accessGrantId = rows.accessGrant.id;
        if (!reservationId || !paymentAttemptId || !accessGrantId) {
          return yield* Effect.fail(new Error("fixture row id missing"));
        }
        reservations.set(reservationId, rows.reservation);
        paymentAttempts.set(paymentAttemptId, rows.paymentAttempt);
        accessGrants.set(accessGrantId, rows.accessGrant);
        if (options.failTransaction) {
          restore(snapshot);
          return yield* Effect.fail(
            new Error("fixture transaction rolled back")
          );
        }
      }),
  };

  return {
    accessGrants,
    cleanupCalls,
    database,
    paymentAttempts,
    reservations,
    transactionCalls,
    verificationCalls,
  } satisfies FakeDatabase;
};

const makeFixtureInput = (referenceNow = Temporal.Now.instant()) => {
  const customerId = DotyposCustomerIdSchema.make("account-history-customer");
  const dotyposReservationId = DotyposReservationIdSchema.make(
    "account-history-provider-reservation"
  );
  const providerStartsAt = floorToWholeHour(
    referenceNow.toZonedDateTimeISO("UTC").add({ days: 120 })
  ).toInstant();
  const providerEndsAt = providerStartsAt.add({ hours: 8 });
  const providerProjection = {
    customer: { id: customerId },
    reservation: {
      _customerId: customerId,
      endDate: providerEndsAt.toString(),
      id: dotyposReservationId,
      startDate: providerStartsAt.toString(),
      status: "CONFIRMED",
    },
  } satisfies WorkspaceE2EReservationHistoryProviderProjection;
  const input = {
    customerId,
    datasourceConfig: {} as DatasourceConfig,
    dotyposReservationId,
  } satisfies WorkspaceE2EReservationHistoryFixtureInput;
  return { input, providerProjection };
};

const makeDependencies = (
  fakeDatabase: FakeDatabase,
  providerProjection: WorkspaceE2EReservationHistoryProviderProjection,
  providerCalls: string[]
) =>
  ({
    database: fakeDatabase.database,
    readProviderReservation: (reservationId) =>
      Effect.sync(() => {
        providerCalls.push(reservationId);
        return providerProjection;
      }),
  }) satisfies WorkspaceE2EReservationHistoryFixtureTestDependencies;

const expectProviderTimingError = async (input: {
  readonly fixtureInput: WorkspaceE2EReservationHistoryFixtureInput;
  readonly providerProjection: WorkspaceE2EReservationHistoryProviderProjection;
}) => {
  const fakeDatabase = makeFakeDatabase();
  const providerCalls: string[] = [];

  await expect(
    Effect.runPromise(
      seedWorkspaceE2EReservationHistory(
        input.fixtureInput,
        makeDependencies(fakeDatabase, input.providerProjection, providerCalls)
      )
    )
  ).rejects.toMatchObject({
    _tag: "WorkspaceE2EError",
    diagnosticCode: "postgres_account_fixture_assertion_failed",
    operation: "read account reservation history provider timing",
  });

  expect(providerCalls).toEqual([input.fixtureInput.dotyposReservationId]);
  expect(fakeDatabase.transactionCalls).toHaveLength(0);
};

test("seeds the exact rows and cleans them through the finalizer", async () => {
  const { input, providerProjection } = makeFixtureInput();
  const fakeDatabase = makeFakeDatabase();
  const providerCalls: string[] = [];
  let fixture: WorkspaceE2EReservationHistoryFixture | undefined;

  await expect(
    Effect.runPromise(
      withWorkspaceE2EReservationHistoryFixture(
        input,
        (value) =>
          Effect.gen(function* () {
            fixture = value;
            const rows = fakeDatabase.transactionCalls[0];
            expect(rows).toBeDefined();
            expect(rows?.reservation.dotyposCustomerId).toBe(input.customerId);
            expect(rows?.reservation.dotyposReservationId).toBe(
              input.dotyposReservationId
            );
            expect(rows?.reservation.reservationState).toBe("confirmed");
            expect(rows?.reservation.paymentState).toBe("paid");
            expect(rows?.reservation.activePaymentAttemptId).toBeNull();
            expect(rows?.paymentAttempt.provider).toBe("internal");
            expect(rows?.paymentAttempt.state).toBe("paid");
            expect(rows?.paymentAttempt.amountValue).toBe(0);
            expect(rows?.paymentAttempt.providerOrderId).toBeUndefined();
            expect(rows?.paymentAttempt.providerOrderCreatedAt).toBeNull();
            expect(rows?.accessGrant.state).toBe("uncertain");
            expect(rows?.accessGrant.accessCode).toBeUndefined();
            expect(rows?.accessGrant.failureCode).toBe(
              "workspace_e2e_fixture_uncertain"
            );
            expect(rows?.accessGrant.scheduledAccessStartsAt).toEqual(
              Temporal.Instant.from(providerProjection.reservation.startDate)
            );
            expect(rows?.accessGrant.accessStartsAt).toEqual(
              Temporal.Instant.from(providerProjection.reservation.startDate)
            );
            expect(rows?.accessGrant.accessEndsAt).toEqual(
              Temporal.Instant.from(providerProjection.reservation.endDate)
            );
            expect(fakeDatabase.reservations.size).toBe(1);
            expect(fakeDatabase.paymentAttempts.size).toBe(1);
            expect(fakeDatabase.accessGrants.size).toBe(1);
            expect(providerProjection.customer.id).toBe(input.customerId);
            return yield* Effect.fail(new Error("exercise finalizer"));
          }),
        makeDependencies(fakeDatabase, providerProjection, providerCalls)
      )
    )
  ).rejects.toThrow("exercise finalizer");

  expect(fixture).toBeDefined();
  expect(providerCalls).toEqual([input.dotyposReservationId]);
  expect(fakeDatabase.cleanupCalls).toEqual([
    {
      id: fixture?.accessGrantId,
      table: "reservation_access_grants",
    },
    {
      id: fixture?.reservationId,
      table: "workspace_reservations",
    },
  ]);
  expect(fakeDatabase.verificationCalls).toEqual([
    {
      id: fixture?.accessGrantId,
      table: "reservation_access_grants",
    },
    {
      id: fixture?.reservationId,
      table: "workspace_reservations",
    },
    {
      id: fixture?.paymentAttemptId,
      table: "payment_attempts",
    },
  ]);
  expect(fakeDatabase.reservations.size).toBe(0);
  expect(fakeDatabase.paymentAttempts.size).toBe(0);
  expect(fakeDatabase.accessGrants.size).toBe(0);
});

test("maps a reversed provider interval through the fixed E2E error boundary", async () => {
  const { input, providerProjection } = makeFixtureInput();
  await expectProviderTimingError({
    fixtureInput: input,
    providerProjection: {
      ...providerProjection,
      reservation: {
        ...providerProjection.reservation,
        endDate: providerProjection.reservation.startDate,
        startDate: providerProjection.reservation.endDate,
      },
    },
  });
});

test("maps malformed provider timestamps through the fixed E2E error boundary", async () => {
  const { input, providerProjection } = makeFixtureInput();
  await expectProviderTimingError({
    fixtureInput: input,
    providerProjection: {
      ...providerProjection,
      reservation: {
        ...providerProjection.reservation,
        startDate: "not-a-provider-timestamp",
      },
    },
  });
});

test("does not leave rows when the seed transaction rolls back", async () => {
  const { input, providerProjection } = makeFixtureInput();
  const fakeDatabase = makeFakeDatabase({ failTransaction: true });
  const providerCalls: string[] = [];

  await expect(
    Effect.runPromise(
      seedWorkspaceE2EReservationHistory(
        input,
        makeDependencies(fakeDatabase, providerProjection, providerCalls)
      )
    )
  ).rejects.toThrow("fixture transaction rolled back");

  expect(providerCalls).toEqual([input.dotyposReservationId]);
  expect(fakeDatabase.transactionCalls).toHaveLength(1);
  expect(fakeDatabase.reservations.size).toBe(0);
  expect(fakeDatabase.paymentAttempts.size).toBe(0);
  expect(fakeDatabase.accessGrants.size).toBe(0);
  expect(fakeDatabase.cleanupCalls).toHaveLength(0);
  expect(fakeDatabase.verificationCalls).toHaveLength(0);
});
