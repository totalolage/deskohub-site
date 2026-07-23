import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { and, eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-pglite";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { relations } from "@/db/relations";
import { workspaceReservations } from "@/db/schema";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
  WorkspaceReservationStateError,
} from "./workspace-reservation.repository";

const createReservationsTable = sql.raw(`
  create table workspace_reservations (
    id text primary key,
    checkout_session_key text not null,
    checkout_attempt_key text not null unique,
    correlation_id text not null unique,
    dotypos_customer_id text not null,
    dotypos_reservation_id text,
    customer_access_code text not null,
    reservation_state text not null,
    payment_state text not null,
    fulfillment_state text not null,
    active_payment_attempt_id text,
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
    updated_at timestamptz not null default now(),
    constraint cancellation_claim_pair check (
      (cancellation_claim_owner is null and cancellation_claimed_at is null)
      or
      (cancellation_claim_owner is not null and cancellation_claimed_at is not null)
    )
  )
`);

const DatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeWithDefaults({ relations }).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db: db as never }))
  )
).pipe(Layer.provide(PgliteClient.layer()));

const RepositoryTestLive = Layer.merge(
  DatabaseLive,
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(DatabaseLive))
);

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
        yield* db.execute(createReservationsTable);
        return yield* effect;
      }).pipe(Effect.provide(RepositoryTestLive))
    )
  );

const instant = (value: string) => Temporal.Instant.from(value);
const expiredAt = instant("2026-07-23T10:00:00Z");

const reservationRow = (
  id: string,
  overrides: Partial<typeof workspaceReservations.$inferInsert> = {}
): typeof workspaceReservations.$inferInsert => ({
  id,
  checkoutSessionKey: `session-${id}`,
  checkoutAttemptKey: `attempt-${id}`,
  correlationId: `correlation-${id}`,
  dotyposCustomerId: `customer-${id}`,
  dotyposReservationId: `provider-${id}`,
  customerAccessCode: "",
  reservationState: "held",
  paymentState: "not_started",
  fulfillmentState: "not_started",
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "cs",
  reservationHoldExpiresAt: expiredAt,
  reservationCreatedAt: instant("2026-07-23T09:00:00Z"),
  ...overrides,
});

describe("WorkspaceReservationRepository cancellation ownership", () => {
  test("allows exactly one competing owner to win a cancellation CAS", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values(reservationRow("owned"));

        const claims = yield* Effect.all(
          [
            repository.claimCancellation({
              id: "owned",
              ownerId: "worker-a",
              recoveryReason: "retryable_failure",
            }),
            repository.claimCancellation({
              id: "owned",
              ownerId: "worker-b",
              recoveryReason: "retryable_failure",
            }),
          ],
          { concurrency: "unbounded" }
        );

        expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
        const [stored] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "owned"));
        expect(stored?.reservationState).toBe("cancelling");
        expect(["worker-a", "worker-b"]).toContain(
          stored?.cancellationClaimOwner
        );
      })
    );
  });

  test("rejects renewals and destructive transitions after ownership is lost", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values(reservationRow("lost"));
        expect(
          yield* repository.claimCancellation({
            id: "lost",
            ownerId: "worker-a",
            recoveryReason: "retryable_failure",
          })
        ).not.toBeNull();

        yield* db
          .update(workspaceReservations)
          .set({
            cancellationClaimOwner: "worker-b",
            cancellationClaimedAt: sql`now()`,
          })
          .where(eq(workspaceReservations.id, "lost"));

        expect(
          yield* repository.renewCancellationClaim({
            id: "lost",
            ownerId: "worker-a",
            recoveryReason: "retryable_failure",
          })
        ).toBeNull();
        const error = yield* Effect.flip(
          repository.markCancelled({
            id: "lost",
            ownerId: "worker-a",
            recoveryReason: "retryable_failure",
            cancelledAt: instant("2026-07-23T10:01:00Z"),
          })
        );
        expect(error).toBeInstanceOf(WorkspaceReservationStateError);
        const [stored] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "lost"));
        expect(stored?.reservationState).toBe("cancelling");
        expect(stored?.cancellationClaimOwner).toBe("worker-b");
      })
    );
  });

  test("uses the database clock and a bounded inclusive stale boundary", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values([
          reservationRow("fresh", {
            reservationState: "cancelling",
            cancellationClaimOwner: "old-owner",
            cancellationClaimedAt: instant("2026-07-23T09:00:00Z"),
          }),
          reservationRow("boundary", {
            reservationState: "cancelling",
            cancellationClaimOwner: "old-owner",
            cancellationClaimedAt: instant("2026-07-23T09:00:00Z"),
          }),
          reservationRow("legacy-ownerless", {
            reservationState: "cancelling",
          }),
        ]);
        yield* db.execute(
          sql.raw(`
          update workspace_reservations
          set cancellation_claimed_at = now() - interval '4 minutes 59 seconds'
          where id = 'fresh'
        `)
        );
        yield* db.execute(
          sql.raw(`
          update workspace_reservations
          set cancellation_claimed_at = now() - interval '5 minutes'
          where id = 'boundary'
        `)
        );
        yield* db.execute(
          sql.raw(`
          update workspace_reservations
          set updated_at = now() - interval '5 minutes'
          where id = 'legacy-ownerless'
        `)
        );

        expect(
          yield* repository.claimCancellation({
            id: "fresh",
            ownerId: "new-owner",
            recoveryReason: "stale_claim_recovery",
          })
        ).toBeNull();
        expect(
          yield* repository.claimCancellation({
            id: "boundary",
            ownerId: "new-owner",
            recoveryReason: "stale_claim_recovery",
          })
        ).not.toBeNull();
        expect(
          yield* repository.claimCancellation({
            id: "legacy-ownerless",
            ownerId: "new-owner",
            recoveryReason: "stale_claim_recovery",
          })
        ).not.toBeNull();
      })
    );
  });

  test("cannot claim a stale cleanup candidate after payment becomes pending", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db
          .insert(workspaceReservations)
          .values(reservationRow("pending-race"));

        const [candidate] = yield* repository.selectCancellationCandidates({
          now: instant("2026-07-23T11:00:00Z"),
          limit: 1,
        });
        expect(candidate?.id).toBe("pending-race");

        yield* db
          .update(workspaceReservations)
          .set({
            paymentState: "pending",
            activePaymentAttemptId: "payment-attempt",
          })
          .where(eq(workspaceReservations.id, "pending-race"));

        expect(
          yield* repository.claimCancellation({
            id: candidate.id,
            ownerId: "cleanup-worker",
            recoveryReason: "hold_expired",
            holdExpiredAt: instant("2026-07-23T11:00:00Z"),
          })
        ).toBeNull();
      })
    );
  });

  test("restores stale legacy pending cancellation rows for provider reconciliation", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values([
          reservationRow("fresh-pending", {
            reservationState: "cancelling",
            paymentState: "pending",
            activePaymentAttemptId: "fresh-attempt",
          }),
          reservationRow("stale-pending", {
            reservationState: "cancelling",
            paymentState: "pending",
            activePaymentAttemptId: "stale-attempt",
          }),
          reservationRow("failed-pending", {
            reservationState: "cancellation_failed",
            paymentState: "pending",
            activePaymentAttemptId: "failed-attempt",
            cancellationFailureDisposition: "manual_review",
          }),
        ]);
        yield* db.execute(
          sql.raw(`
          update workspace_reservations
          set updated_at = now() - interval '5 minutes'
          where id = 'stale-pending'
        `)
        );

        expect(
          yield* repository.restorePendingCancellationForReconciliation(
            "fresh-pending"
          )
        ).toBeNull();
        expect(
          yield* repository.restorePendingCancellationForReconciliation(
            "stale-pending"
          )
        ).toMatchObject({ reservationState: "held", paymentState: "pending" });
        expect(
          yield* repository.restorePendingCancellationForReconciliation(
            "failed-pending"
          )
        ).toMatchObject({ reservationState: "held", paymentState: "pending" });
      })
    );
  });

  test("manual-review poison rows cannot starve later retryable work", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values(
          Array.from({ length: 25 }, (_, index) =>
            reservationRow(`manual-${index}`, {
              reservationState: "cancellation_failed",
              cancellationFailureDisposition: "manual_review",
              failureCode: "provider_refused_cancellation",
            })
          )
        );
        yield* db.insert(workspaceReservations).values(
          reservationRow("retryable", {
            reservationState: "cancellation_failed",
            cancellationFailureDisposition: "retryable",
            cancellationRetryAt: instant("2026-07-23T10:00:00Z"),
          })
        );

        const candidates = yield* repository.selectCancellationCandidates({
          now: instant("2026-07-23T11:00:00Z"),
          limit: 1,
        });
        expect(candidates.map(({ id }) => id)).toEqual(["retryable"]);
      })
    );
  });

  test("attachment compensation is immediately retryable and claimable", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values(
          reservationRow("attachment", {
            reservationState: "creating_hold",
            dotyposReservationId: null,
            reservationCreatedAt: null,
            reservationHoldExpiresAt: null,
          })
        );

        const handoff = {
          id: "attachment",
          dotyposReservationId: "provider-attachment",
          reservationCreatedAt: instant("2026-07-23T09:00:00Z"),
          failureCode: "attach_failed",
        };
        expect(
          yield* repository.recordAttachmentCancellationHandoff(handoff)
        ).not.toBeNull();
        expect(
          yield* repository.recordAttachmentCancellationHandoff(handoff)
        ).not.toBeNull();

        const [stored] = yield* db
          .select()
          .from(workspaceReservations)
          .where(
            and(
              eq(workspaceReservations.id, "attachment"),
              eq(
                workspaceReservations.cancellationFailureDisposition,
                "retryable"
              )
            )
          );
        expect(stored?.cancellationRetryAt).not.toBeNull();
        expect(stored?.cancellationRecoveryReason).toBe(
          "attachment_compensation"
        );
        expect(stored?.reservationHoldExpiresAt).toBeNull();
        expect(stored?.reservationHoldExpiredAt).toBeNull();
        const claimed = yield* repository.claimCancellation({
          id: "attachment",
          ownerId: "compensation-worker",
          recoveryReason: "attachment_compensation",
        });
        expect(claimed).toMatchObject({
          reservationState: "cancelling",
          cancellationClaimOwner: "compensation-worker",
        });
        expect(
          yield* repository.recordAttachmentCancellationHandoff(handoff)
        ).toBeNull();
        const [owned] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "attachment"));
        expect(owned?.cancellationClaimOwner).toBe("compensation-worker");
      })
    );
  });

  test("persists recovery reasons while only genuine expiry records an audit timestamp", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        yield* db.insert(workspaceReservations).values([
          reservationRow("expired-audit"),
          reservationRow("retry-audit", {
            reservationState: "cancellation_failed",
            cancellationFailureDisposition: "retryable",
            cancellationRetryAt: instant("2026-07-23T10:00:00Z"),
            cancellationRecoveryReason: "retryable_failure",
          }),
          reservationRow("supersession-audit", {
            reservationState: "cancellation_failed",
            cancellationFailureDisposition: "retryable",
            cancellationRetryAt: instant("2026-07-23T10:00:00Z"),
            cancellationRecoveryReason: "supersession_recovery",
          }),
          reservationRow("stale-audit", {
            reservationState: "cancelling",
            cancellationClaimOwner: "old-owner",
            cancellationClaimedAt: instant("2026-07-23T09:00:00Z"),
            cancellationRecoveryReason: "attachment_compensation",
          }),
        ]);
        yield* db
          .update(workspaceReservations)
          .set({
            cancellationClaimedAt: sql`now() - interval '5 minutes'`,
          })
          .where(eq(workspaceReservations.id, "stale-audit"));

        const holdExpiredAt = instant("2026-07-23T11:00:00Z");
        expect(
          yield* repository.claimCancellation({
            id: "expired-audit",
            ownerId: "expiry-worker",
            recoveryReason: "hold_expired",
            holdExpiredAt,
          })
        ).not.toBeNull();
        expect(
          yield* repository.claimCancellation({
            id: "retry-audit",
            ownerId: "retry-worker",
            recoveryReason: "retryable_failure",
          })
        ).not.toBeNull();
        expect(
          yield* repository.claimCancellation({
            id: "supersession-audit",
            ownerId: "supersession-worker",
            recoveryReason: "supersession_recovery",
          })
        ).not.toBeNull();
        expect(
          yield* repository.claimCancellation({
            id: "stale-audit",
            ownerId: "stale-worker",
            recoveryReason: "stale_claim_recovery",
          })
        ).not.toBeNull();

        const rows = yield* db
          .select({
            id: workspaceReservations.id,
            cancellationRecoveryReason:
              workspaceReservations.cancellationRecoveryReason,
            reservationHoldExpiredAt:
              workspaceReservations.reservationHoldExpiredAt,
          })
          .from(workspaceReservations)
          .orderBy(workspaceReservations.id);
        expect(
          rows.map((row) => ({
            id: row.id,
            reason: row.cancellationRecoveryReason,
            expired: row.reservationHoldExpiredAt?.toString() ?? null,
          }))
        ).toEqual([
          {
            id: "expired-audit",
            reason: "hold_expired",
            expired: holdExpiredAt.toString(),
          },
          {
            id: "retry-audit",
            reason: "retryable_failure",
            expired: null,
          },
          {
            id: "stale-audit",
            reason: "stale_claim_recovery",
            expired: null,
          },
          {
            id: "supersession-audit",
            reason: "supersession_recovery",
            expired: null,
          },
        ]);
      })
    );
  });
});
