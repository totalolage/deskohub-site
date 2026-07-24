import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import { DotyposService } from "@deskohub/dotypos";
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-pglite";
import { Deferred, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { relations } from "@/db/relations";
import { paymentAttempts, workspaceReservations } from "@/db/schema";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  PaymentAttemptRepository,
  PaymentAttemptRepositoryLive,
  PaymentAttemptStateError,
} from "./payment-attempt.repository";

mock.module("server-only", () => ({}));

const unresolvedRecoveryMarkers = [
  "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000",
  "hold_creation_candidate:synthetic-epoch:synthetic-provider:1780308000000:1780308120000",
  "hold_creation_candidate_compensating:synthetic-epoch:synthetic-provider:1780308000000",
  "hold_creation_orphan_recovery:synthetic-epoch:synthetic-loser",
  "hold_creation_orphan_processing:synthetic-epoch:synthetic-loser:synthetic-owner",
  "hold_creation_orphan_awaiting_visibility:synthetic-epoch:synthetic-loser:1780308000000",
  "hold_creation_orphan_verifying:synthetic-epoch:synthetic-loser:1780308000000:synthetic-owner",
] as const;

const createUuidFunction = sql.raw(`
  create function uuid_generate_v7() returns uuid language sql volatile as $$
    select gen_random_uuid()
  $$
`);

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
    updated_at timestamptz not null default now()
  )
`);

const createPaymentAttemptsTable = sql.raw(`
  create table payment_attempts (
    id text primary key,
    workspace_reservation_id text not null references workspace_reservations(id),
    provider text not null,
    provider_order_id text not null unique,
    security_token text,
    state text not null,
    amount_value integer not null,
    amount_exponent integer not null,
    currency text not null,
    provider_redirect_url text,
    last_webhook_event_id text,
    last_provider_operation_id text,
    last_provider_status text,
    failure_code text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  )
`);

const DatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeWithDefaults({ relations }).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db: db as never }))
  )
).pipe(Layer.provide(PgliteClient.layer()));

const RepositoryTestLive = Layer.mergeAll(
  DatabaseLive,
  PaymentAttemptRepositoryLive.pipe(Layer.provide(DatabaseLive)),
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(DatabaseLive))
);

const runRepositoryTest = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | PaymentAttemptRepository
    | WorkspaceDatabase
    | WorkspaceReservationRepository
  >
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        yield* db.execute(createUuidFunction);
        yield* db.execute(createReservationsTable);
        yield* db.execute(createPaymentAttemptsTable);
        return yield* effect;
      }).pipe(Effect.provide(RepositoryTestLive))
    )
  );

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
  locale: "en-US",
  reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
  reservationCreatedAt: Temporal.Now.instant(),
  ...overrides,
});

const createAttempt = (
  repository: PaymentAttemptRepository,
  reservationId: string,
  providerOrderId = `provider-order-${reservationId}`
) =>
  repository.create({
    workspaceReservationId: reservationId,
    providerOrderId,
    amountValue: 1000,
    amountExponent: 2,
    currency: "CZK",
  });

const makeProviderEvidence = (input: {
  readonly id: string;
  readonly orderId: string;
  readonly epoch: string;
  readonly customerId: string;
}) => {
  const note = `Payment order: ${input.orderId}\nProvider creation epoch: ${input.epoch}`;
  const provider = {
    id: input.id,
    _branchId: "synthetic-branch",
    _cloudId: "synthetic-cloud",
    _customerId: input.customerId,
    _tableId: "synthetic-table",
    startDate: "2026-06-01T10:00:00.000Z",
    endDate: "2026-06-01T11:00:00.000Z",
    seats: "2",
    status: "NEW" as const,
  };
  const evidence = createHash("sha256")
    .update(
      JSON.stringify([
        provider._branchId,
        provider._cloudId,
        provider._customerId,
        provider._tableId,
        Date.parse(provider.startDate),
        Date.parse(provider.endDate),
        Number(provider.seats),
        provider.status,
        note,
      ])
    )
    .digest("base64url");
  return {
    ...provider,
    note: `${note}\nProvider request evidence: ${evidence}`,
  };
};

describe("PaymentAttemptRepository real database admission", () => {
  test("executes the generated attachment-recovery predicate for every fence", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const payments = yield* PaymentAttemptRepository;

        for (const [
          index,
          failureCode,
        ] of unresolvedRecoveryMarkers.entries()) {
          const id = `fenced-${index}`;
          yield* db
            .insert(workspaceReservations)
            .values(reservationRow(id, { failureCode }));

          const result = yield* createAttempt(payments, id).pipe(Effect.result);
          expect(result._tag).toBe("Failure");
          if (result._tag === "Failure") {
            expect(result.failure).toBeInstanceOf(PaymentAttemptStateError);
          }

          const storedAttempts = yield* db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.workspaceReservationId, id));
          const [storedReservation] = yield* db
            .select()
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, id));
          expect(storedAttempts).toEqual([]);
          expect(storedReservation).toMatchObject({
            activePaymentAttemptId: null,
            failureCode,
            paymentState: "not_started",
          });
        }

        const attachedId = "attached-control";
        yield* db.insert(workspaceReservations).values(
          reservationRow(attachedId, {
            failureCode: "hold_creation_attached:synthetic-epoch",
          })
        );
        yield* createAttempt(payments, attachedId);
        expect(
          yield* db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.workspaceReservationId, attachedId))
        ).toHaveLength(1);
      })
    );
  });

  test("uses database time to reject missing, reached, and expired hold deadlines", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const payments = yield* PaymentAttemptRepository;
        const cases = [
          ["missing", "null"],
          ["expired", "clock_timestamp() - interval '1 millisecond'"],
          ["reached", "clock_timestamp()"],
          ["future", "clock_timestamp() + interval '1 minute'"],
        ] as const;

        for (const [id, deadlineSql] of cases) {
          yield* db
            .insert(workspaceReservations)
            .values(reservationRow(id, { reservationHoldExpiresAt: null }));
          yield* db.execute(
            sql.raw(`
              update workspace_reservations
              set reservation_hold_expires_at = ${deadlineSql}
              where id = '${id}'
            `)
          );

          const result = yield* createAttempt(payments, id).pipe(Effect.result);
          if (id === "future") {
            expect(result._tag).toBe("Success");
          } else {
            expect(result._tag).toBe("Failure");
            if (result._tag === "Failure") {
              expect(result.failure).toBeInstanceOf(PaymentAttemptStateError);
            }
          }
        }

        const attempts = yield* db.select().from(paymentAttempts);
        expect(attempts).toHaveLength(1);
        expect(attempts[0]?.workspaceReservationId).toBe("future");
      })
    );
  });

  test("lets cleanup win a real expired-hold payment race without persisting an attempt", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const payments = yield* PaymentAttemptRepository;
        const reservations = yield* WorkspaceReservationRepository;
        const id = "expired-payment-race";
        yield* db.insert(workspaceReservations).values(
          reservationRow(id, {
            reservationHoldExpiresAt: Temporal.Now.instant().subtract({
              seconds: 1,
            }),
          })
        );

        const [paymentResult, cleanupClaim] = yield* Effect.all(
          [
            createAttempt(payments, id).pipe(Effect.result),
            reservations.claimCancellation({
              id,
              ownerId: "synthetic-cleanup-owner",
              recoveryReason: "hold_expired",
              holdExpiredAt: Temporal.Now.instant(),
            }),
          ],
          { concurrency: "unbounded" }
        );

        expect(paymentResult._tag).toBe("Failure");
        if (paymentResult._tag === "Failure") {
          expect(paymentResult.failure).toBeInstanceOf(
            PaymentAttemptStateError
          );
        }
        expect(cleanupClaim).not.toBeNull();
        expect(yield* db.select().from(paymentAttempts)).toEqual([]);
        const [stored] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id));
        expect(stored).toMatchObject({
          activePaymentAttemptId: null,
          cancellationClaimOwner: "synthetic-cleanup-owner",
          paymentState: "not_started",
          reservationState: "cancelling",
        });
      })
    );
  });

  test("keeps the real payment CAS fenced while a durable cleanup handoff fails", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleError,
      ReservationHoldCleanupScheduleService,
    } = await import(
      "@/features/checkout/backend/holds/reservation-hold-cleanup-queue.service"
    );
    const { ReservationHoldCleanupService } = await import(
      "@/features/checkout/backend/holds/reservation-hold-cleanup.service"
    );

    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const payments = yield* PaymentAttemptRepository;
        const epoch = "synthetic-live-handoff-race-epoch";
        const id = "live-handoff-payment-race";
        const providerId = "synthetic-live-handoff-provider";
        const createdAt = Temporal.Instant.from("2026-06-01T09:55:00Z");
        const stabilizationDeadline = Temporal.Instant.from(
          "2026-06-01T10:00:00Z"
        );
        yield* db.insert(workspaceReservations).values(
          reservationRow(id, {
            dotyposReservationId: providerId,
            reservationCreatedAt: createdAt,
            failureCode: `hold_creation_candidate:${epoch}:${providerId}:${createdAt.epochMilliseconds}:${stabilizationDeadline.epochMilliseconds}`,
          })
        );

        const enqueueStarted = Deferred.makeUnsafe<void>();
        const releaseEnqueue = Deferred.makeUnsafe<void>();
        let enqueueCalls = 0;
        const payload = getAttachmentCancellationScheduleMessage({
          recoveryKind: "attachment_unknown",
          orderId: id,
          providerCreationEpoch: epoch,
          dotyposReservationId: providerId,
          reservationCreatedAt: createdAt,
          stabilizeCandidate: true,
        }).payload;
        const process = processReservationHoldCleanupScheduleMessage(
          payload,
          Temporal.Now.instant()
        ).pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(ReservationHoldCleanupScheduleService, {
                enqueueCleanup: () =>
                  Effect.sync(() => {
                    enqueueCalls += 1;
                  }).pipe(
                    Effect.andThen(Deferred.succeed(enqueueStarted, undefined)),
                    Effect.andThen(Deferred.await(releaseEnqueue)),
                    Effect.andThen(
                      Effect.fail(
                        new ReservationHoldCleanupScheduleError({
                          message: "Synthetic durable handoff failure.",
                        })
                      )
                    )
                  ),
              }),
              Layer.succeed(DotyposService, {
                listReservations: () =>
                  Effect.succeed([
                    makeProviderEvidence({
                      id: providerId,
                      orderId: id,
                      epoch,
                      customerId: `customer-${id}`,
                    }),
                  ]),
              } as unknown as typeof DotyposService.Service),
              Layer.succeed(ReservationHoldCleanupService, {
                cancelOrderHold: () =>
                  Effect.die("Candidate stabilization must not cancel winner"),
                sweepExpiredHolds: () =>
                  Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 }),
              })
            )
          ),
          Effect.result,
          Effect.ensuring(Deferred.succeed(enqueueStarted, undefined))
        );
        const payment = Deferred.await(enqueueStarted).pipe(
          Effect.andThen(createAttempt(payments, id).pipe(Effect.result)),
          Effect.tap(() => Deferred.succeed(releaseEnqueue, undefined))
        );

        const [processResult, paymentResult] = yield* Effect.all(
          [process, payment],
          { concurrency: "unbounded" }
        );

        expect(processResult._tag).toBe("Failure");
        expect(enqueueCalls).toBe(1);
        expect(paymentResult._tag).toBe("Failure");
        if (paymentResult._tag === "Failure") {
          expect(paymentResult.failure).toBeInstanceOf(
            PaymentAttemptStateError
          );
        }
        expect(yield* db.select().from(paymentAttempts)).toEqual([]);
        const [stored] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, id));
        expect(stored).toMatchObject({
          activePaymentAttemptId: null,
          failureCode: expect.stringContaining(
            `hold_creation_candidate:${epoch}:${providerId}:`
          ),
          paymentState: "not_started",
        });
      })
    );
  });
});
