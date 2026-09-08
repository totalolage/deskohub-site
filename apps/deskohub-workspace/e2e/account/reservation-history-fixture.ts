import "../../shared/polyfills/temporal";

import {
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposReservation,
  type DotyposReservationId,
  DotyposService,
} from "@deskohub/dotypos";
import {
  type IgloohomeDeviceId,
  IgloohomeDeviceIdSchema,
} from "@deskohub/igloohome";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import {
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
import { getDotyposReservationTiming } from "@/features/reservation/backend/workspace-reservation.service";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { getReservationAccessInterval } from "@/features/reservation-access";
import {
  type ReservationAccessGrantId,
  reservationAccessGrantIdSchema,
} from "@/features/reservation-access/reservation-access";
import type { DatabaseClient } from "../../db/database-client";
import type { DatasourceConfig } from "../config";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { getDotyposLayer } from "../integrations/dotypos";
import { assert } from "../runtime";

const fixtureAmount = {
  exponent: 2,
  value: 0,
} as const;

export type WorkspaceE2EReservationHistoryFixtureInput = {
  readonly datasourceConfig: DatasourceConfig;
  readonly customerId: DotyposCustomerId;
  readonly dotyposReservationId: DotyposReservationId;
};

export type WorkspaceE2EReservationHistoryFixture = {
  readonly accessGrantId: ReservationAccessGrantId;
  readonly dotyposReservationId: DotyposReservationId;
  readonly paymentAttemptId: PaymentAttemptId;
  readonly reservationId: WorkspaceReservationId;
};

type WorkspaceE2EReservationHistoryRows = {
  readonly accessGrant: typeof reservationAccessGrants.$inferInsert;
  readonly paymentAttempt: typeof paymentAttempts.$inferInsert;
  readonly reservation: typeof workspaceReservations.$inferInsert;
};

export type WorkspaceE2EReservationHistoryProviderProjection = {
  readonly customer: Pick<DotyposCustomer, "id">;
  readonly reservation: Pick<
    DotyposReservation,
    "id" | "_customerId" | "startDate" | "endDate" | "status"
  >;
};

export type WorkspaceE2EReservationHistoryDatabase = {
  readonly deleteAccessGrant: (
    id: ReservationAccessGrantId
  ) => Effect.Effect<unknown, unknown>;
  readonly deleteReservation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<unknown, unknown>;
  readonly findAccessGrant: (
    id: ReservationAccessGrantId
  ) => Effect.Effect<
    readonly { readonly id: ReservationAccessGrantId }[],
    unknown
  >;
  readonly findPaymentAttempt: (
    id: PaymentAttemptId
  ) => Effect.Effect<readonly { readonly id: PaymentAttemptId }[], unknown>;
  readonly findReservation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    readonly { readonly id: WorkspaceReservationId }[],
    unknown
  >;
  readonly transaction: (
    rows: WorkspaceE2EReservationHistoryRows
  ) => Effect.Effect<void, unknown>;
};

type WorkspaceE2EReservationHistoryFixtureDependencies = {
  readonly database?: WorkspaceE2EReservationHistoryDatabase;
  readonly readProviderReservation?: (
    reservationId: DotyposReservationId
  ) => Effect.Effect<WorkspaceE2EReservationHistoryProviderProjection, unknown>;
};

export type WorkspaceE2EReservationHistoryFixtureTestDependencies =
  Required<WorkspaceE2EReservationHistoryFixtureDependencies>;

const makeFixtureIds = () => ({
  accessGrantId: reservationAccessGrantIdSchema.make(
    `account-history-grant-${crypto.randomUUID()}`
  ),
  paymentAttemptId: paymentAttemptIdSchema.make(
    `account-history-payment-${crypto.randomUUID()}`
  ),
  reservationId: workspaceReservationIdSchema.make(
    `account-history-${crypto.randomUUID()}`
  ),
});

const makeReservationHistoryDatabase = (
  db: DatabaseClient
): WorkspaceE2EReservationHistoryDatabase => ({
  deleteAccessGrant: (id) =>
    db
      .delete(reservationAccessGrants)
      .where(eq(reservationAccessGrants.id, id)),
  deleteReservation: (id) =>
    db.delete(workspaceReservations).where(eq(workspaceReservations.id, id)),
  findAccessGrant: (id) =>
    db
      .select({ id: reservationAccessGrants.id })
      .from(reservationAccessGrants)
      .where(eq(reservationAccessGrants.id, id)),
  findPaymentAttempt: (id) =>
    db
      .select({ id: paymentAttempts.id })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, id)),
  findReservation: (id) =>
    db
      .select({ id: workspaceReservations.id })
      .from(workspaceReservations)
      .where(eq(workspaceReservations.id, id)),
  transaction: (rows) =>
    db.transaction((tx) =>
      Effect.gen(function* () {
        yield* tx.insert(workspaceReservations).values(rows.reservation);
        yield* tx.insert(paymentAttempts).values(rows.paymentAttempt);
        yield* tx.insert(reservationAccessGrants).values(rows.accessGrant);
      })
    ),
});

const resolveReservationHistoryDatabase = (
  dependencies: WorkspaceE2EReservationHistoryFixtureDependencies
): Effect.Effect<WorkspaceE2EReservationHistoryDatabase, never, E2EDatabase> =>
  dependencies.database
    ? Effect.succeed(dependencies.database)
    : Effect.map(E2EDatabase, ({ db }) => makeReservationHistoryDatabase(db));

const readProviderReservation = (
  input: WorkspaceE2EReservationHistoryFixtureInput,
  dependencies: WorkspaceE2EReservationHistoryFixtureDependencies
): Effect.Effect<WorkspaceE2EReservationHistoryProviderProjection, unknown> => {
  if (dependencies.readProviderReservation) {
    return dependencies.readProviderReservation(input.dotyposReservationId);
  }

  return Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* dotypos.getReservation(input.dotyposReservationId);
  }).pipe(Effect.provide(getDotyposLayer(input.datasourceConfig)));
};

export function seedWorkspaceE2EReservationHistory(
  input: WorkspaceE2EReservationHistoryFixtureInput,
  dependencies: WorkspaceE2EReservationHistoryFixtureTestDependencies
): Effect.Effect<WorkspaceE2EReservationHistoryFixture, WorkspaceE2EError>;
export function seedWorkspaceE2EReservationHistory(
  input: WorkspaceE2EReservationHistoryFixtureInput,
  dependencies?: WorkspaceE2EReservationHistoryFixtureDependencies
): Effect.Effect<
  WorkspaceE2EReservationHistoryFixture,
  WorkspaceE2EError,
  E2EDatabase
>;
export function seedWorkspaceE2EReservationHistory(
  input: WorkspaceE2EReservationHistoryFixtureInput,
  dependencies: WorkspaceE2EReservationHistoryFixtureDependencies = {}
): Effect.Effect<
  WorkspaceE2EReservationHistoryFixture,
  WorkspaceE2EError,
  E2EDatabase
> {
  return Effect.gen(function* () {
    const ids = makeFixtureIds();
    const providerReservation = yield* readProviderReservation(
      input,
      dependencies
    ).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("read account reservation history provider fixture", {
          cause,
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "read account reservation history provider fixture",
        })
      )
    );
    yield* tryWorkspaceE2ESync(
      "assert account reservation history provider fixture",
      () => {
        assert(
          providerReservation.reservation.id === input.dotyposReservationId,
          "account reservation history provider reservation id mismatch"
        );
        assert(
          providerReservation.reservation.status === "CONFIRMED",
          "account reservation history provider reservation is not confirmed"
        );
        assert(
          providerReservation.reservation._customerId === input.customerId,
          "account reservation history provider reservation customer mismatch"
        );
        assert(
          providerReservation.customer.id === input.customerId,
          "account reservation history provider customer mismatch"
        );
      }
    );
    const dotyposReservationId = input.dotyposReservationId;

    const providerTiming = yield* getDotyposReservationTiming({
      reservationId: ids.reservationId,
      reservation: providerReservation.reservation,
    }).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("read account reservation history provider timing", {
          cause,
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "read account reservation history provider timing",
        })
      )
    );
    const accessInterval = yield* getReservationAccessInterval({
      reservationId: ids.reservationId,
      ...providerTiming,
    }).pipe(
      Effect.mapError((cause) =>
        workspaceE2EError("calculate account reservation access interval", {
          cause,
          diagnosticCode: "postgres_account_fixture_assertion_failed",
          operation: "calculate account reservation access interval",
        })
      )
    );
    const now = Temporal.Now.instant();
    const deviceId: IgloohomeDeviceId = IgloohomeDeviceIdSchema.make(
      `account-history-device-${crypto.randomUUID()}`
    );
    const database = yield* resolveReservationHistoryDatabase(dependencies);

    yield* runDatabaseOperation(
      "seed account reservation history rows",
      database.transaction({
        reservation: {
          id: ids.reservationId,
          checkoutAttemptKey: checkoutAttemptKeySchema.make(
            `account-history-attempt-${crypto.randomUUID()}`
          ),
          checkoutSessionKey: checkoutSessionKeySchema.make(
            `account-history-session-${crypto.randomUUID()}`
          ),
          dotyposCustomerId: input.customerId,
          dotyposReservationId,
          reservationState: "confirmed",
          paymentState: "paid",
          fulfillmentState: "fulfilled",
          activePaymentAttemptId: null,
          reservationDetails: {
            coffee: false,
            entryTier: "basic",
            kind: "cowork",
          },
          locale: "en-US",
          reservationCreatedAt: now,
          reservationConfirmedAt: now,
          paidAt: now,
          fulfilledAt: now,
        },
        paymentAttempt: {
          id: ids.paymentAttemptId,
          workspaceReservationId: ids.reservationId,
          provider: "internal",
          state: "paid",
          amountValue: fixtureAmount.value,
          amountExponent: fixtureAmount.exponent,
          currency: "CZK",
          providerOrderCreatedAt: null,
        },
        accessGrant: {
          id: ids.accessGrantId,
          workspaceReservationId: ids.reservationId,
          deviceId,
          state: "uncertain",
          failureCode: "workspace_e2e_fixture_uncertain",
          scheduledAccessStartsAt: accessInterval.scheduledStartsAt,
          accessStartsAt: accessInterval.startsAt,
          accessEndsAt: accessInterval.endsAt,
        },
      })
    );

    return {
      accessGrantId: ids.accessGrantId,
      dotyposReservationId,
      paymentAttemptId: ids.paymentAttemptId,
      reservationId: ids.reservationId,
    };
  });
}

export function cleanupWorkspaceE2EReservationHistory(
  fixture: WorkspaceE2EReservationHistoryFixture,
  dependencies: WorkspaceE2EReservationHistoryFixtureTestDependencies
): Effect.Effect<void, WorkspaceE2EError>;
export function cleanupWorkspaceE2EReservationHistory(
  fixture: WorkspaceE2EReservationHistoryFixture,
  dependencies?: WorkspaceE2EReservationHistoryFixtureDependencies
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
export function cleanupWorkspaceE2EReservationHistory(
  fixture: WorkspaceE2EReservationHistoryFixture,
  dependencies: WorkspaceE2EReservationHistoryFixtureDependencies = {}
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> {
  return Effect.gen(function* () {
    const database = yield* resolveReservationHistoryDatabase(dependencies);

    yield* runDatabaseOperation(
      "delete account reservation history access grant",
      database.deleteAccessGrant(fixture.accessGrantId)
    );
    yield* runDatabaseOperation(
      "delete account reservation history reservation",
      database.deleteReservation(fixture.reservationId)
    );

    const remainingGrant = yield* runDatabaseOperation(
      "verify account reservation history access grant cleanup",
      database.findAccessGrant(fixture.accessGrantId)
    );
    const remainingReservation = yield* runDatabaseOperation(
      "verify account reservation history reservation cleanup",
      database.findReservation(fixture.reservationId)
    );
    const remainingPaymentAttempt = yield* runDatabaseOperation(
      "verify account reservation history payment cleanup",
      database.findPaymentAttempt(fixture.paymentAttemptId)
    );

    if (
      remainingGrant.length > 0 ||
      remainingReservation.length > 0 ||
      remainingPaymentAttempt.length > 0
    ) {
      return yield* workspaceE2EError(
        "Account reservation history fixture cleanup did not converge",
        {
          diagnosticCode: "postgres_account_fixture_convergence_failed",
          operation: "verify account reservation history fixture cleanup",
        }
      );
    }
  });
}

export function withWorkspaceE2EReservationHistoryFixture<A, E, R>(
  input: WorkspaceE2EReservationHistoryFixtureInput,
  use: (
    fixture: WorkspaceE2EReservationHistoryFixture
  ) => Effect.Effect<A, E, R>,
  dependencies: WorkspaceE2EReservationHistoryFixtureTestDependencies
): Effect.Effect<A, E | WorkspaceE2EError, R>;
export function withWorkspaceE2EReservationHistoryFixture<A, E, R>(
  input: WorkspaceE2EReservationHistoryFixtureInput,
  use: (
    fixture: WorkspaceE2EReservationHistoryFixture
  ) => Effect.Effect<A, E, R>,
  dependencies?: WorkspaceE2EReservationHistoryFixtureDependencies
): Effect.Effect<A, E | WorkspaceE2EError, E2EDatabase | R>;
export function withWorkspaceE2EReservationHistoryFixture<A, E, R>(
  input: WorkspaceE2EReservationHistoryFixtureInput,
  use: (
    fixture: WorkspaceE2EReservationHistoryFixture
  ) => Effect.Effect<A, E, R>,
  dependencies: WorkspaceE2EReservationHistoryFixtureDependencies = {}
): Effect.Effect<A, E | WorkspaceE2EError, E2EDatabase | R> {
  return Effect.acquireUseRelease(
    seedWorkspaceE2EReservationHistory(input, dependencies),
    use,
    (fixture) => cleanupWorkspaceE2EReservationHistory(fixture, dependencies)
  );
}
