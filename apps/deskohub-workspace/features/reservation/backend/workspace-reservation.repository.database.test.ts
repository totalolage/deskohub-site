import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-pglite";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceReservations } from "@/db/schema";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "./workspace-reservation.repository";

const DatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeWithDefaults({ relations: {} }).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db: db as never }))
  )
).pipe(Layer.provide(PgliteClient.layer()));

const TestLive = Layer.mergeAll(
  DatabaseLive,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(DatabaseLive))
);

const createSchema = sql.raw(`
  create table workspace_reservations (
    id text primary key,
    checkout_session_key text not null,
    checkout_attempt_key text not null,
    checkout_session_identity_key text not null,
    checkout_attempt_identity_key text not null,
    checkout_session_compatibility_key text not null,
    checkout_attempt_compatibility_key text not null,
    correlation_id text not null,
    dotypos_customer_id text not null,
    dotypos_reservation_id text,
    customer_access_code text not null,
    reservation_state text not null,
    payment_state text not null,
    fulfillment_state text not null,
    active_payment_attempt_id text,
    active_payment_evidence_conflicted boolean not null default false,
    payment_reconciliation_attempt_id text,
    payment_reconciliation_claim_id text,
    payment_reconciliation_claim_expires_at timestamptz,
    reservation_details jsonb not null,
    locale text not null,
    reservation_hold_expires_at timestamptz,
    reservation_hold_expired_at timestamptz,
    reservation_created_at timestamptz,
    reservation_confirmed_at timestamptz,
    reservation_cancelled_at timestamptz,
    cancellation_claim_owner text,
    cancellation_claimed_at timestamptz,
    cancellation_failure_disposition text,
    cancellation_retry_at timestamptz,
    cancellation_recovery_reason text,
    paid_at timestamptz,
    fulfilled_at timestamptz,
    fulfillment_failed_at timestamptz,
    failure_code text,
    fulfillment_failure_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`);

const insertPaidReservation = sql.raw(`
  insert into workspace_reservations (
    id,
    checkout_session_key,
    checkout_attempt_key,
    checkout_session_identity_key,
    checkout_attempt_identity_key,
    checkout_session_compatibility_key,
    checkout_attempt_compatibility_key,
    correlation_id,
    dotypos_customer_id,
    dotypos_reservation_id,
    customer_access_code,
    reservation_state,
    payment_state,
    fulfillment_state,
    reservation_details,
    locale,
    paid_at,
    created_at,
    updated_at
  ) values (
    'reservation-id',
    'session-key',
    'attempt-key',
    'session-identity-key',
    'attempt-identity-key',
    'session-compatibility-key',
    'attempt-compatibility-key',
    'correlation-id',
    'customer-id',
    'dotypos-reservation-id',
    '',
    'held',
    'paid',
    'not_started',
    '{"kind":"meeting-room"}',
    'cs-CZ',
    '2026-07-25T10:00:00Z',
    '2026-07-25T10:00:00Z',
    '2026-07-25T10:00:00Z'
  )
`);

const runRepositoryTest = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    WorkspaceDatabase | WorkspaceReservationRepository
  >
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        yield* db.execute(createSchema);
        yield* db.execute(insertPaidReservation);
        return yield* effect;
      }).pipe(Effect.provide(TestLive))
    )
  );

const firstClaimThreshold = Temporal.Instant.from("2026-07-25T09:50:00Z");
const staleClaimThreshold = Temporal.Instant.from("2026-07-25T10:05:00Z");
const completionTime = Temporal.Instant.from("2026-07-25T10:10:00Z");

describe("WorkspaceReservationRepository paid fulfillment", () => {
  test("grants exactly one concurrent claim and fences fresh processing", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const repository = yield* WorkspaceReservationRepository;
        const claims = yield* Effect.all(
          [
            repository.claimPaidFulfillment({
              id: "reservation-id",
              staleProcessingBefore: firstClaimThreshold,
            }),
            repository.claimPaidFulfillment({
              id: "reservation-id",
              staleProcessingBefore: firstClaimThreshold,
            }),
          ],
          { concurrency: "unbounded" }
        );

        expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
        expect(claims.filter((claim) => claim === null)).toHaveLength(1);
      })
    );
  });

  test("allows stale processing takeover and fences the fresh replacement", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db
          .update(workspaceReservations)
          .set({
            fulfillmentState: "processing",
            updatedAt: Temporal.Instant.from("2026-07-25T09:45:00Z"),
          })
          .where(eq(workspaceReservations.id, "reservation-id"));

        expect(
          yield* repository.claimPaidFulfillment({
            id: "reservation-id",
            staleProcessingBefore: staleClaimThreshold,
          })
        ).not.toBeNull();
        expect(
          yield* repository.claimPaidFulfillment({
            id: "reservation-id",
            staleProcessingBefore: staleClaimThreshold,
          })
        ).toBeNull();
      })
    );
  });

  test("marks only a claimed paid reservation fulfilled", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* repository.claimPaidFulfillment({
          id: "reservation-id",
          staleProcessingBefore: firstClaimThreshold,
        });
        yield* repository.markFulfilled({
          id: "reservation-id",
          fulfilledAt: completionTime,
        });

        const [fulfilled] = yield* db
          .select({
            state: workspaceReservations.fulfillmentState,
            fulfilledAt: workspaceReservations.fulfilledAt,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "reservation-id"));
        expect(fulfilled?.state).toBe("fulfilled");
        expect(fulfilled?.fulfilledAt).toEqual(completionTime);

        expect(
          yield* repository
            .markFulfilled({
              id: "reservation-id",
              fulfilledAt: completionTime,
            })
            .pipe(
              Effect.match({
                onFailure: (error) =>
                  error._tag === "WorkspaceReservationStateError",
                onSuccess: () => false,
              })
            )
        ).toBe(true);
      })
    );
  });

  test("records a claimed failure and makes it reclaimable", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* repository.claimPaidFulfillment({
          id: "reservation-id",
          staleProcessingBefore: firstClaimThreshold,
        });
        yield* repository.markFulfillmentFailed({
          id: "reservation-id",
          failureCode: "synthetic_failure",
          failedAt: completionTime,
        });

        const [failed] = yield* db
          .select({
            state: workspaceReservations.fulfillmentState,
            failedAt: workspaceReservations.fulfillmentFailedAt,
            failureCode: workspaceReservations.fulfillmentFailureCode,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "reservation-id"));
        expect(failed).toEqual({
          state: "failed",
          failedAt: completionTime,
          failureCode: "synthetic_failure",
        });
        expect(
          yield* repository.claimPaidFulfillment({
            id: "reservation-id",
            staleProcessingBefore: firstClaimThreshold,
          })
        ).not.toBeNull();
      })
    );
  });
});
