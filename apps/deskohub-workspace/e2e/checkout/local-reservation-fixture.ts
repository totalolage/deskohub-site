import "../../shared/polyfills/temporal";

import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { type PaymentState, workspaceReservations } from "@/db/schema";
import {
  type CheckoutAttemptKey,
  type CheckoutSessionKey,
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
} from "@/features/checkout/checkout-identifiers";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import type { DatabaseClient } from "../../db/database-client";
import { seedWorkspaceE2EReservationAuthor } from "../account/auth-rows";
import {
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
  workspaceE2EError,
} from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { assert } from "../runtime";

export type WorkspaceE2ELocalReservationFixture = {
  readonly checkoutAttemptKey: CheckoutAttemptKey;
  readonly checkoutSessionKey: CheckoutSessionKey;
  readonly customerId: DotyposCustomerId;
  readonly reservationId: WorkspaceReservationId;
};

export type WorkspaceE2ELocalReservationDatabase = {
  readonly deleteReservation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<unknown, unknown>;
  readonly findReservation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    readonly { readonly id: WorkspaceReservationId }[],
    unknown
  >;
  readonly transaction: (
    use: (
      transaction: WorkspaceE2ELocalReservationTransaction
    ) => Effect.Effect<unknown, unknown>
  ) => Effect.Effect<unknown, unknown>;
};

export type WorkspaceE2ELocalReservationTransaction = {
  readonly findReservation: (
    id: WorkspaceReservationId
  ) => Effect.Effect<
    readonly { readonly id: WorkspaceReservationId }[],
    unknown
  >;
  /** Inserts the reservation with its customer's author account. */
  readonly insertReservation: (
    row: Omit<typeof workspaceReservations.$inferInsert, "authorAccountId">
  ) => Effect.Effect<unknown, unknown>;
};

/**
 * The payment outcome of the seeded checkout. Each leaves an expired hold
 * without a Dotypos reservation or payment attempt, so the status page shows
 * it from the persisted row alone.
 */
export type WorkspaceE2ELocalReservationPaymentState = Extract<
  PaymentState,
  "cancelled" | "expired" | "failed"
>;

type WorkspaceE2ELocalReservationFixtureDependencies = {
  readonly database?: WorkspaceE2ELocalReservationDatabase;
};

export type WorkspaceE2ELocalReservationFixtureTestDependencies =
  Required<WorkspaceE2ELocalReservationFixtureDependencies>;

const makeFixture = (): WorkspaceE2ELocalReservationFixture => {
  const id = crypto.randomUUID();
  return {
    checkoutAttemptKey: checkoutAttemptKeySchema.make(
      `local-reservation-attempt-${id}`
    ),
    checkoutSessionKey: checkoutSessionKeySchema.make(
      `local-reservation-session-${id}`
    ),
    customerId: DotyposCustomerIdSchema.make(
      `local-reservation-customer-${id}`
    ),
    reservationId: workspaceReservationIdSchema.make(`local-reservation-${id}`),
  };
};

const makeDatabase = (
  db: DatabaseClient
): WorkspaceE2ELocalReservationDatabase => ({
  deleteReservation: (id) =>
    db.delete(workspaceReservations).where(eq(workspaceReservations.id, id)),
  findReservation: (id) =>
    db
      .select({ id: workspaceReservations.id })
      .from(workspaceReservations)
      .where(eq(workspaceReservations.id, id)),
  transaction: (use) =>
    db.transaction((tx) =>
      use({
        findReservation: (id) =>
          tx
            .select({ id: workspaceReservations.id })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, id)),
        insertReservation: (row) =>
          seedWorkspaceE2EReservationAuthor(tx, row.dotyposCustomerId).pipe(
            Effect.flatMap((authorAccountId) =>
              tx
                .insert(workspaceReservations)
                .values({ ...row, authorAccountId })
            )
          ),
      })
    ),
});

const resolveDatabase = (
  dependencies: WorkspaceE2ELocalReservationFixtureDependencies
): Effect.Effect<WorkspaceE2ELocalReservationDatabase, never, E2EDatabase> =>
  dependencies.database
    ? Effect.succeed(dependencies.database)
    : Effect.map(E2EDatabase, ({ db }) => makeDatabase(db));

const makeReservationRow = (
  fixture: WorkspaceE2ELocalReservationFixture,
  paymentState: WorkspaceE2ELocalReservationPaymentState
): Omit<typeof workspaceReservations.$inferInsert, "authorAccountId"> => {
  const now = Temporal.Now.instant();
  return {
    activeCustomerEmailDeliveryId: null,
    activePaymentAttemptId: null,
    checkoutAttemptKey: fixture.checkoutAttemptKey,
    checkoutSessionKey: fixture.checkoutSessionKey,
    dotyposReservationId: null,
    dotyposCustomerId: fixture.customerId,
    fulfillmentState: "not_started",
    id: fixture.reservationId,
    locale: "en-US",
    paymentState,
    reservationCreatedAt: now,
    reservationDetails: {
      coffee: false,
      entryTier: "basic",
      kind: "cowork",
    },
    reservationHoldExpiredAt: now,
    reservationHoldExpiresAt: null,
    reservationState: "hold_expired",
  };
};

export function seedWorkspaceE2ELocalReservation(
  dependencies: WorkspaceE2ELocalReservationFixtureTestDependencies,
  paymentState?: WorkspaceE2ELocalReservationPaymentState
): Effect.Effect<WorkspaceE2ELocalReservationFixture, WorkspaceE2EError>;
export function seedWorkspaceE2ELocalReservation(
  dependencies?: WorkspaceE2ELocalReservationFixtureDependencies,
  paymentState?: WorkspaceE2ELocalReservationPaymentState
): Effect.Effect<
  WorkspaceE2ELocalReservationFixture,
  WorkspaceE2EError,
  E2EDatabase
>;
export function seedWorkspaceE2ELocalReservation(
  dependencies: WorkspaceE2ELocalReservationFixtureDependencies = {},
  paymentState: WorkspaceE2ELocalReservationPaymentState = "expired"
): Effect.Effect<
  WorkspaceE2ELocalReservationFixture,
  WorkspaceE2EError,
  E2EDatabase
> {
  return Effect.gen(function* () {
    const fixture = makeFixture();
    const database = yield* resolveDatabase(dependencies);
    yield* runDatabaseOperation(
      "seed and verify local reservation fixture",
      database.transaction((transaction) =>
        Effect.gen(function* () {
          yield* transaction.insertReservation(
            makeReservationRow(fixture, paymentState)
          );
          const rows = yield* transaction.findReservation(
            fixture.reservationId
          );
          yield* tryWorkspaceE2ESync(
            "assert local reservation fixture seed",
            () => {
              assert(
                rows.length === 1,
                "local reservation fixture row was not persisted"
              );
            }
          );
        })
      )
    );

    return fixture;
  });
}

export function cleanupWorkspaceE2ELocalReservation(
  fixture: WorkspaceE2ELocalReservationFixture,
  dependencies: WorkspaceE2ELocalReservationFixtureTestDependencies
): Effect.Effect<void, WorkspaceE2EError>;
export function cleanupWorkspaceE2ELocalReservation(
  fixture: WorkspaceE2ELocalReservationFixture,
  dependencies?: WorkspaceE2ELocalReservationFixtureDependencies
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase>;
export function cleanupWorkspaceE2ELocalReservation(
  fixture: WorkspaceE2ELocalReservationFixture,
  dependencies: WorkspaceE2ELocalReservationFixtureDependencies = {}
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> {
  return Effect.gen(function* () {
    const database = yield* resolveDatabase(dependencies);
    yield* runDatabaseOperation(
      "delete local reservation fixture",
      database.deleteReservation(fixture.reservationId)
    );

    const rows = yield* runDatabaseOperation(
      "verify local reservation fixture cleanup",
      database.findReservation(fixture.reservationId)
    );
    if (rows.length > 0) {
      return yield* workspaceE2EError(
        "Local reservation fixture cleanup did not converge",
        {
          diagnosticCode: "postgres_account_fixture_convergence_failed",
          operation: "verify local reservation fixture cleanup",
        }
      );
    }
  });
}

export function withWorkspaceE2ELocalReservationFixture<A, E, R>(
  use: (fixture: WorkspaceE2ELocalReservationFixture) => Effect.Effect<A, E, R>,
  dependencies: WorkspaceE2ELocalReservationFixtureTestDependencies
): Effect.Effect<A, E | WorkspaceE2EError, R>;
export function withWorkspaceE2ELocalReservationFixture<A, E, R>(
  use: (fixture: WorkspaceE2ELocalReservationFixture) => Effect.Effect<A, E, R>,
  dependencies?: WorkspaceE2ELocalReservationFixtureDependencies
): Effect.Effect<A, E | WorkspaceE2EError, E2EDatabase | R>;
export function withWorkspaceE2ELocalReservationFixture<A, E, R>(
  use: (fixture: WorkspaceE2ELocalReservationFixture) => Effect.Effect<A, E, R>,
  dependencies: WorkspaceE2ELocalReservationFixtureDependencies = {}
): Effect.Effect<A, E | WorkspaceE2EError, E2EDatabase | R> {
  return Effect.acquireUseRelease(
    seedWorkspaceE2ELocalReservation(dependencies),
    use,
    (fixture) => cleanupWorkspaceE2ELocalReservation(fixture, dependencies)
  );
}
