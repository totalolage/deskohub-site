import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-pglite";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { paidFulfillmentJobs, paymentPaidEvents } from "@/db/schema";
import {
  PaidFulfillmentRepository,
  PaidFulfillmentRepositoryLive,
} from "./paid-fulfillment.repository";

const DatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeWithDefaults({ relations: {} }).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db: db as never }))
  )
).pipe(Layer.provide(PgliteClient.layer()));

const TestLive = Layer.mergeAll(
  DatabaseLive,
  PaidFulfillmentRepositoryLive.pipe(Layer.provide(DatabaseLive))
);

const schemaStatements = [
  sql.raw(`
    create table workspace_reservations (
      id text primary key,
      active_payment_attempt_id text,
      payment_state text not null,
      fulfillment_state text not null,
      paid_at timestamptz
    )
  `),
  sql.raw(`
    create table payment_attempts (
      id text primary key,
      workspace_reservation_id text not null,
      state text not null
    )
  `),
  sql.raw(`
    create table payment_paid_events (
      id text primary key default 'generated-event-id',
      payment_attempt_id text not null unique,
      workspace_reservation_id text not null,
      paid_at timestamptz not null,
      created_at timestamptz not null default now()
    )
  `),
  sql.raw(`
    create table paid_fulfillment_jobs (
      id text primary key default 'generated-job-id',
      payment_paid_event_id text not null unique
        references payment_paid_events(id),
      workspace_reservation_id text not null,
      state text not null default 'pending',
      attempt_count integer not null default 0,
      lease_owner_id text,
      claimed_at timestamptz,
      next_attempt_at timestamptz not null default now(),
      completed_at timestamptz,
      failure_code text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `),
  sql.raw(`
    create function enqueue_paid_event_from_reservation() returns trigger
    language plpgsql
    as $$
    begin
      if new.payment_state = 'paid'
        and new.active_payment_attempt_id is not null
        and new.paid_at is not null
      then
        insert into payment_paid_events (
          id, payment_attempt_id, workspace_reservation_id, paid_at
        )
        select
          'event-' || attempt.id,
          attempt.id,
          new.id,
          new.paid_at
        from payment_attempts as attempt
        where attempt.id = new.active_payment_attempt_id
          and attempt.workspace_reservation_id = new.id
          and attempt.state = 'paid'
        on conflict (payment_attempt_id) do nothing;
      end if;
      return new;
    end;
    $$
  `),
  sql.raw(`
    create trigger workspace_reservations_enqueue_paid_event
    after update of payment_state, active_payment_attempt_id, paid_at
    on workspace_reservations
    for each row execute function enqueue_paid_event_from_reservation()
  `),
];

const runRepositoryTest = <A, E>(
  effect: Effect.Effect<A, E, PaidFulfillmentRepository | WorkspaceDatabase>
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        for (const statement of schemaStatements) {
          yield* db.execute(statement);
        }
        yield* db.execute(sql`
          insert into payment_paid_events (
            id, payment_attempt_id, workspace_reservation_id, paid_at
          ) values (
            'event-id', 'attempt-id', 'reservation-id',
            '2026-07-25T10:00:00Z'
          )
        `);
        yield* db.execute(sql`
          insert into paid_fulfillment_jobs (
            id, payment_paid_event_id, workspace_reservation_id,
            next_attempt_at
          ) values (
            'job-id', 'event-id', 'reservation-id',
            '2026-07-25T10:00:00Z'
          )
        `);
        return yield* effect;
      }).pipe(Effect.provide(TestLive))
    )
  );

const now = Temporal.Instant.from("2026-07-25T10:05:00Z");
const staleBefore = Temporal.Instant.from("2026-07-25T09:50:00Z");

describe("PaidFulfillmentRepository database behavior", () => {
  test("captures the paid transition durably before job materialization", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaidFulfillmentRepository;
        yield* db.execute(sql`
          insert into workspace_reservations (
            id, active_payment_attempt_id, payment_state, fulfillment_state
          ) values (
            'recovery-reservation', 'recovery-attempt', 'pending', 'not_started'
          )
        `);
        yield* db.execute(sql`
          insert into payment_attempts (
            id, workspace_reservation_id, state
          ) values (
            'recovery-attempt', 'recovery-reservation', 'pending'
          )
        `);
        yield* db.execute(sql`
          update payment_attempts
          set state = 'paid'
          where id = 'recovery-attempt'
        `);
        yield* db.execute(sql`
          update workspace_reservations
          set payment_state = 'paid',
              paid_at = '2026-07-25T10:05:00Z'
          where id = 'recovery-reservation'
        `);

        expect(
          yield* db
            .select()
            .from(paymentPaidEvents)
            .where(eq(paymentPaidEvents.paymentAttemptId, "recovery-attempt"))
        ).toHaveLength(1);
        expect(yield* repository.reconcilePaidReservations({ limit: 25 })).toBe(
          1
        );
        expect(
          yield* db
            .select()
            .from(paidFulfillmentJobs)
            .where(
              eq(
                paidFulfillmentJobs.workspaceReservationId,
                "recovery-reservation"
              )
            )
        ).toHaveLength(1);
      })
    );
  });

  test("grants exactly one concurrent owner", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const repository = yield* PaidFulfillmentRepository;
        const claims = yield* Effect.all(
          [
            repository.claim({
              id: "job-id",
              ownerId: "worker-a",
              now,
              staleBefore,
            }),
            repository.claim({
              id: "job-id",
              ownerId: "worker-b",
              now,
              staleBefore,
            }),
          ],
          { concurrency: "unbounded" }
        );

        expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
        expect(claims.filter((claim) => claim === null)).toHaveLength(1);
      })
    );
  });

  test("takes over stale leases and fences the expired owner", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaidFulfillmentRepository;
        yield* db
          .update(paidFulfillmentJobs)
          .set({
            state: "processing",
            attemptCount: 1,
            leaseOwnerId: "expired-worker",
            claimedAt: Temporal.Instant.from("2026-07-25T09:45:00Z"),
          })
          .where(eq(paidFulfillmentJobs.id, "job-id"));

        const takeover = yield* repository.claim({
          id: "job-id",
          ownerId: "recovery-worker",
          now,
          staleBefore,
        });
        expect(takeover?.leaseOwnerId).toBe("recovery-worker");
        expect(takeover?.attemptCount).toBe(2);
        expect(
          yield* repository.markCompleted({
            id: "job-id",
            ownerId: "expired-worker",
            completedAt: now,
          })
        ).toBe(false);
        expect(
          yield* repository.markCompleted({
            id: "job-id",
            ownerId: "recovery-worker",
            completedAt: now,
          })
        ).toBe(true);
      })
    );
  });

  test("retires a crashed final attempt to manual recovery", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaidFulfillmentRepository;
        yield* db
          .update(paidFulfillmentJobs)
          .set({
            state: "processing",
            attemptCount: 8,
            leaseOwnerId: "final-worker",
            claimedAt: Temporal.Instant.from("2026-07-25T09:45:00Z"),
          })
          .where(eq(paidFulfillmentJobs.id, "job-id"));

        expect(
          yield* repository.retireExhaustedLeases({ now, staleBefore })
        ).toBe(1);
        const [job] = yield* db
          .select()
          .from(paidFulfillmentJobs)
          .where(eq(paidFulfillmentJobs.id, "job-id"));
        expect(job).toMatchObject({
          state: "manual",
          leaseOwnerId: null,
          claimedAt: null,
          failureCode: "paid_fulfillment_attempts_exhausted",
        });
      })
    );
  });
});
