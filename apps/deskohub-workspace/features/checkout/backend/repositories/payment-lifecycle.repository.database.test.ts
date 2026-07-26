import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import * as PgliteClient from "@effect/sql-pglite/PgliteClient";
import { eq, sql } from "drizzle-orm";
import { makeWithDefaults } from "drizzle-orm/effect-pglite";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { relations } from "@/db/relations";
import {
  discountApplications,
  discountCodeRedemptions,
  paymentAttempts,
  paymentEvidenceConflicts,
  paymentPaidEvents,
  workspaceReservations,
} from "@/db/schema";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { discountIdSchema } from "@/features/discounts/contracts";
import {
  discountCodeIdSchema,
  storedDiscountIdSchema,
} from "@/features/discounts/persistence-contracts";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
} from "@/features/reservation/backend/workspace-reservation.repository";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import {
  PaymentLifecycleRepository,
  PaymentLifecycleStateError,
} from "./payment-lifecycle.repository";
import { paymentLifecycleTestSchemaStatements } from "./payment-lifecycle.repository.test-schema";

mock.module("server-only", () => ({}));

const paidEventMigration = await Bun.file(
  new URL(
    "../../../../db/migrations/20260726065958_pink_komodo/migration.sql",
    import.meta.url
  )
).text();
const paidEventBridgeStart = paidEventMigration.indexOf(
  'CREATE FUNCTION "enqueue_paid_event_from_reservation"'
);
const rollbackFenceStart = paidEventMigration.indexOf(
  'CREATE FUNCTION "guard_unverified_v2_terminal_settlement"'
);
if (paidEventBridgeStart < 0) {
  throw new Error("Paid event bridge is missing from the migration.");
}
if (rollbackFenceStart < 0) {
  throw new Error("Rollback fence is missing from the migration.");
}
const rollbackFenceStatements = paidEventMigration
  .slice(rollbackFenceStart, paidEventBridgeStart)
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean)
  .map(sql.raw);
const paidEventBridgeStatements = paidEventMigration
  .slice(
    paidEventBridgeStart,
    paidEventMigration.indexOf(
      "-- The fulfillment queue is jobs-only",
      paidEventBridgeStart
    )
  )
  .split("--> statement-breakpoint")
  .map((statement) => statement.trim())
  .filter(Boolean)
  .map(sql.raw);

const reconcilePaidEvents = sql.raw(`
  insert into payment_paid_events (
    payment_attempt_id, workspace_reservation_id, paid_at
  )
  select attempt.id, reservation.id, reservation.paid_at
  from payment_attempts as attempt
  join workspace_reservations as reservation
    on reservation.id = attempt.workspace_reservation_id
    and reservation.active_payment_attempt_id = attempt.id
  where attempt.state = 'paid'
    and reservation.payment_state = 'paid'
    and reservation.paid_at is not null
  on conflict (payment_attempt_id) do nothing
`);

const DatabaseLive = Layer.effect(
  WorkspaceDatabase,
  makeWithDefaults({ relations }).pipe(
    Effect.map((db) => WorkspaceDatabase.of({ db: db as never }))
  )
).pipe(Layer.provide(PgliteClient.layer()));

const TestLive = Layer.mergeAll(
  DatabaseLive,
  PaymentLifecycleRepository.Live.pipe(Layer.provide(DatabaseLive)),
  WorkspaceReservationRepositoryLive.pipe(Layer.provide(DatabaseLive))
);

const runRepositoryTest = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    | PaymentLifecycleRepository
    | WorkspaceDatabase
    | WorkspaceReservationRepository
  >
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        for (const statement of paymentLifecycleTestSchemaStatements) {
          yield* db.execute(statement);
        }
        for (const statement of rollbackFenceStatements) {
          yield* db.execute(statement);
        }
        for (const statement of paidEventBridgeStatements) {
          yield* db.execute(statement);
        }
        return yield* effect;
      }).pipe(Effect.provide(TestLive))
    )
  );

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

const noDiscountPricing = {
  fingerprint: "pricing-fingerprint",
  total: money(1000),
  discounts: [],
} as const;

const emptyCommitment = makeDiscountCommitment({
  product: { kind: "cowork", tier: "basic" },
  applications: [],
});

const seedReservation = (
  id: string,
  deadline: ReturnType<typeof sql.raw> = sql.raw(
    "clock_timestamp() + interval '5 minutes'"
  ),
  customerId = `customer-${id}`
) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    yield* db.execute(
      sql`insert into workspace_reservations (
        id,
        checkout_session_key,
        checkout_attempt_key,
        correlation_id,
        dotypos_customer_id,
        dotypos_reservation_id,
        reservation_state,
        payment_state,
        fulfillment_state,
        reservation_hold_expires_at
      ) values (
        ${id},
        ${`session-${id}`},
        ${`attempt-${id}`},
        ${`correlation-${id}`},
        ${customerId},
        ${`provider-${id}`},
        'held',
        'not_started',
        'not_started',
        ${deadline}
      )`
    );
  });

const admit = (
  repository: typeof PaymentLifecycleRepository.Service,
  reservationId: string,
  input: {
    readonly commitment?: typeof emptyCommitment;
    readonly acceptedPricing?: typeof noDiscountPricing;
    readonly affirmedPricing?: typeof noDiscountPricing;
    readonly allowNewAdmission?: boolean;
    readonly providerOrderId?: string;
  } = {}
) =>
  repository.admitPaymentStart({
    workspaceReservationId: reservationId,
    checkoutSessionKey: `session-${reservationId}`,
    providerOrderId: input.providerOrderId ?? `provider-order-${reservationId}`,
    acceptedPricing: input.acceptedPricing ?? noDiscountPricing,
    affirmedPricing: input.affirmedPricing ?? noDiscountPricing,
    commitment: input.commitment ?? emptyCommitment,
    locale: "en-US",
    allowNewAdmission: input.allowNewAdmission ?? true,
  });

describe("PaymentLifecycleRepository database behavior", () => {
  test("concurrent admission converges on one durable attempt and one start lease", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("concurrent");

        const results = yield* Effect.all(
          [admit(repository, "concurrent"), admit(repository, "concurrent")],
          { concurrency: "unbounded" }
        );

        expect(results.map(({ outcome }) => outcome).sort()).toEqual([
          "created",
          "starting",
        ]);
        expect(
          yield* db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.workspaceReservationId, "concurrent"))
        ).toHaveLength(1);
      })
    );
  });

  test("a durable provider reconciliation claim fences replacement admission", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("reconciliation-claim");

        const admitted = yield* admit(repository, "reconciliation-claim");
        expect(admitted.outcome).toBe("created");
        if (admitted.outcome !== "created") return;

        const claim = yield* repository.claimProviderReconciliation({
          id: admitted.attempt.id,
          workspaceReservationId: "reconciliation-claim",
        });
        expect(claim.outcome).toBe("claimed");
        if (claim.outcome !== "claimed") return;

        expect(yield* admit(repository, "reconciliation-claim")).toEqual({
          outcome: "unavailable",
          reason: "active_attempt",
        });
        expect(
          yield* db
            .select()
            .from(paymentAttempts)
            .where(
              eq(paymentAttempts.workspaceReservationId, "reconciliation-claim")
            )
        ).toHaveLength(1);

        yield* db
          .update(workspaceReservations)
          .set({
            paymentReconciliationClaimExpiresAt: sql`clock_timestamp() - interval '1 second'`,
          })
          .where(eq(workspaceReservations.id, "reconciliation-claim"));
        expect(
          (yield* repository
            .markPaid({
              id: admitted.attempt.id,
              workspaceReservationId: "reconciliation-claim",
              paidAt: Temporal.Instant.from("2026-07-25T00:00:00Z"),
              reconciliationClaimId: claim.claimId,
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        const takeover = yield* repository.claimProviderReconciliation({
          id: admitted.attempt.id,
          workspaceReservationId: "reconciliation-claim",
        });
        expect(takeover.outcome).toBe("claimed");
        if (takeover.outcome !== "claimed") return;
        expect(takeover.claimId).not.toBe(claim.claimId);

        yield* repository.releaseProviderReconciliation({
          id: admitted.attempt.id,
          workspaceReservationId: "reconciliation-claim",
          claimId: claim.claimId,
        });
        expect(
          (yield* db
            .select({
              claimId: workspaceReservations.paymentReconciliationClaimId,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, "reconciliation-claim")))[0]
        ).toEqual({ claimId: takeover.claimId });
        yield* repository.releaseProviderReconciliation({
          id: admitted.attempt.id,
          workspaceReservationId: "reconciliation-claim",
          claimId: takeover.claimId,
        });
      })
    );
  });

  test("a historical reconciliation claim owns the reservation during evidence handling", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("historical-reconciliation-claim");

        const historical = yield* admit(
          repository,
          "historical-reconciliation-claim",
          { providerOrderId: "historical-provider-order" }
        );
        expect(historical.outcome).toBe("created");
        if (historical.outcome !== "created") return;
        yield* repository.markTerminal({
          id: historical.attempt.id,
          workspaceReservationId: "historical-reconciliation-claim",
          state: "failed",
          failureCode: "nexi_payment_failed",
          providerOperationId: "historical-operation",
          providerStatus: "DECLINED",
        });

        const active = yield* admit(
          repository,
          "historical-reconciliation-claim",
          { providerOrderId: "active-provider-order" }
        );
        expect(active.outcome).toBe("created");
        if (active.outcome !== "created") return;

        const claim = yield* repository.claimProviderReconciliation({
          id: historical.attempt.id,
          workspaceReservationId: "historical-reconciliation-claim",
        });
        expect(claim.outcome).toBe("claimed");
        if (claim.outcome !== "claimed") return;
        expect(claim.attempt.id).toBe(historical.attempt.id);

        expect(
          (yield* repository
            .markTerminal({
              id: active.attempt.id,
              workspaceReservationId: "historical-reconciliation-claim",
              state: "failed",
              failureCode: "competing_settlement",
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ fulfillmentState: "processing" })
            .where(
              eq(workspaceReservations.id, "historical-reconciliation-claim")
            )
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ reservationState: "cancelling" })
            .where(
              eq(workspaceReservations.id, "historical-reconciliation-claim")
            )
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          yield* admit(repository, "historical-reconciliation-claim", {
            providerOrderId: "competing-provider-order",
          })
        ).toEqual({
          outcome: "unavailable",
          reason: "active_attempt",
        });

        yield* db
          .update(workspaceReservations)
          .set({
            paymentReconciliationClaimExpiresAt: sql`clock_timestamp() - interval '1 second'`,
          })
          .where(
            eq(workspaceReservations.id, "historical-reconciliation-claim")
          );
        const activeTakeover = yield* repository.claimProviderReconciliation({
          id: active.attempt.id,
          workspaceReservationId: "historical-reconciliation-claim",
        });
        expect(activeTakeover.outcome).toBe("claimed");
        if (activeTakeover.outcome !== "claimed") return;
        expect(activeTakeover.isActiveAttempt).toBeTrue();

        yield* repository.releaseProviderReconciliation({
          id: historical.attempt.id,
          workspaceReservationId: "historical-reconciliation-claim",
          claimId: claim.claimId,
        });
        yield* repository.releaseProviderReconciliation({
          id: active.attempt.id,
          workspaceReservationId: "historical-reconciliation-claim",
          claimId: activeTakeover.claimId,
        });
      })
    );
  });

  test("keeps admitted recovery available while blocking new admission", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("gated-new");

        expect(
          yield* admit(repository, "gated-new", {
            allowNewAdmission: false,
          })
        ).toEqual({
          outcome: "unavailable",
          reason: "admission_disabled",
        });
        expect(yield* db.select().from(paymentAttempts)).toHaveLength(0);

        const first = yield* admit(repository, "gated-new");
        expect(first.outcome).toBe("created");
        if (first.outcome !== "created") return;
        yield* db.execute(sql`
          update payment_attempts
          set provider_start_lease_expires_at =
            clock_timestamp() - interval '1 microsecond'
          where id = ${first.attempt.id}
        `);

        const recovered = yield* admit(repository, "gated-new", {
          allowNewAdmission: false,
        });
        expect(recovered.outcome).toBe("reconciling");
        if (recovered.outcome !== "reconciling") return;
        expect(recovered.attempt.id).toBe(first.attempt.id);
        expect(recovered.attempt.providerOrderId).toBe(
          first.attempt.providerOrderId
        );
        expect(recovered.attempt.providerStartLeaseId).toBe(
          first.providerStartLeaseId
        );
      })
    );
  });

  test("an expired start reconciles without takeover and a delayed owner cannot overwrite settlement", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("lease-takeover");

        const oldOwner = yield* admit(repository, "lease-takeover");
        expect(oldOwner.outcome).toBe("created");
        if (oldOwner.outcome !== "created") return;
        yield* db.execute(sql`
          update payment_attempts
          set provider_start_lease_expires_at =
            clock_timestamp() - interval '1 microsecond'
          where id = ${oldOwner.attempt.id}
        `);

        const reconciliation = yield* admit(repository, "lease-takeover", {
          allowNewAdmission: false,
        });
        expect(reconciliation.outcome).toBe("reconciling");
        if (reconciliation.outcome !== "reconciling") return;

        yield* repository.markPaid({
          id: reconciliation.attempt.id,
          workspaceReservationId: "lease-takeover",
          paidAt: Temporal.Instant.from("2026-07-25T03:00:00Z"),
        });

        expect(
          yield* repository.markProviderStartFailed({
            id: oldOwner.attempt.id,
            workspaceReservationId: "lease-takeover",
            providerStartLeaseId: oldOwner.providerStartLeaseId,
            failureCode: "delayed_provider_failure",
            providerStatus: "provider_start_failed",
          })
        ).toEqual({ outcome: "lost" });

        const [attempt] = yield* db
          .select({ state: paymentAttempts.state })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, oldOwner.attempt.id));
        const [reservation] = yield* db
          .select({ paymentState: workspaceReservations.paymentState })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "lease-takeover"));
        expect(attempt).toMatchObject({ state: "paid" });
        expect(reservation).toMatchObject({ paymentState: "paid" });
      })
    );
  });

  test("uses database time for admission and attach deadline guards", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation(
          "expired",
          sql.raw("clock_timestamp() - interval '1 microsecond'")
        );
        expect((yield* admit(repository, "expired")).outcome).toBe(
          "unavailable"
        );

        yield* seedReservation("unresolved");
        yield* db
          .update(workspaceReservations)
          .set({ failureCode: "hold_creation_orphan_recovery:test" })
          .where(eq(workspaceReservations.id, "unresolved"));
        expect((yield* admit(repository, "unresolved")).outcome).toBe(
          "unavailable"
        );

        yield* seedReservation("attach");
        const admission = yield* admit(repository, "attach");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;
        yield* db
          .update(workspaceReservations)
          .set({
            reservationHoldExpiresAt: Temporal.Instant.from(
              "2000-01-01T00:00:00Z"
            ),
          })
          .where(eq(workspaceReservations.id, "attach"));
        expect(
          (yield* repository.attachProviderSession({
            id: admission.attempt.id,
            workspaceReservationId: "attach",
            checkoutSessionKey: "session-attach",
            providerOrderId: admission.attempt.providerOrderId,
            providerStartLeaseId: admission.providerStartLeaseId,
            securityToken: "non-secret-test-token",
            providerRedirectUrl: "https://provider.example/hosted",
          })).outcome
        ).toBe("lost");

        yield* seedReservation("attach-unresolved");
        const unresolvedAdmission = yield* admit(
          repository,
          "attach-unresolved"
        );
        expect(unresolvedAdmission.outcome).toBe("created");
        if (unresolvedAdmission.outcome !== "created") return;
        yield* db
          .update(workspaceReservations)
          .set({ failureCode: "hold_creation_candidate:test" })
          .where(eq(workspaceReservations.id, "attach-unresolved"));
        expect(
          (yield* repository.attachProviderSession({
            id: unresolvedAdmission.attempt.id,
            workspaceReservationId: "attach-unresolved",
            checkoutSessionKey: "session-attach-unresolved",
            providerOrderId: unresolvedAdmission.attempt.providerOrderId,
            providerStartLeaseId: unresolvedAdmission.providerStartLeaseId,
            securityToken: "non-secret-test-token",
            providerRedirectUrl: "https://provider.example/hosted",
          })).outcome
        ).toBe("lost");

        yield* seedReservation("materialized");
        const materializedAdmission = yield* admit(repository, "materialized");
        expect(materializedAdmission.outcome).toBe("created");
        if (materializedAdmission.outcome !== "created") return;

        const credential = randomUUID();
        const redirectUrl = `https://provider.example/hosted/${randomUUID()}?opaque=${randomUUID()}`;
        const attachmentInput = {
          id: materializedAdmission.attempt.id,
          workspaceReservationId: "materialized",
          checkoutSessionKey: "session-materialized",
          providerOrderId: materializedAdmission.attempt.providerOrderId,
          providerStartLeaseId: materializedAdmission.providerStartLeaseId,
          securityToken: credential,
          providerRedirectUrl: redirectUrl,
        };
        expect(
          (yield* repository.attachProviderSession(attachmentInput)).outcome
        ).toBe("attached");
        expect(
          (yield* repository.attachProviderSession(attachmentInput)).outcome
        ).toBe("attached");
        expect(
          (yield* repository.attachProviderSession({
            ...attachmentInput,
            securityToken: randomUUID(),
          })).outcome
        ).toBe("lost");
      })
    );
  });

  test("requires active attempt and aggregate compatibility while allowing legacy terminal retry", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;

        yield* seedReservation("inconsistent");
        const active = yield* admit(repository, "inconsistent");
        expect(active.outcome).toBe("created");
        yield* db
          .update(workspaceReservations)
          .set({ paymentState: "paid" })
          .where(eq(workspaceReservations.id, "inconsistent"));
        expect((yield* admit(repository, "inconsistent")).outcome).toBe(
          "unavailable"
        );

        yield* seedReservation("legacy");
        yield* db.insert(paymentAttempts).values({
          id: "legacy-attempt",
          workspaceReservationId: "legacy",
          provider: "nexi",
          providerOrderId: "legacy-provider-order",
          admissionVersion: 1,
          state: "failed",
          amountValue: 1000,
          amountExponent: 2,
          currency: "CZK",
          failureCode: "legacy_failure",
        });
        yield* db
          .update(workspaceReservations)
          .set({
            activePaymentAttemptId: "legacy-attempt",
            paymentState: "failed",
          })
          .where(eq(workspaceReservations.id, "legacy"));

        expect((yield* admit(repository, "legacy")).outcome).toBe("created");
        expect(
          yield* db
            .select()
            .from(paymentAttempts)
            .where(eq(paymentAttempts.workspaceReservationId, "legacy"))
        ).toHaveLength(2);

        yield* seedReservation("legacy-attached");
        yield* db.insert(paymentAttempts).values({
          id: "legacy-attached-attempt",
          workspaceReservationId: "legacy-attached",
          provider: "nexi",
          providerOrderId: "legacy-attached-provider-order",
          admissionVersion: 1,
          securityToken: "opaque-test-session-handle",
          providerRedirectUrl: "https://provider.invalid/hpp",
          state: "pending",
          amountValue: 1000,
          amountExponent: 2,
          currency: "CZK",
        });
        yield* db
          .update(workspaceReservations)
          .set({
            activePaymentAttemptId: "legacy-attached-attempt",
            paymentState: "pending",
          })
          .where(eq(workspaceReservations.id, "legacy-attached"));

        const legacyReuse = yield* admit(repository, "legacy-attached", {
          allowNewAdmission: false,
        });
        expect(legacyReuse.outcome).toBe("reuse");
        if (legacyReuse.outcome === "reuse") {
          expect(legacyReuse.attempt.id).toBe("legacy-attached-attempt");
        }
      })
    );
  });

  test("recovers exact discounted v1 sessions and reconciles ambiguous v1 starts read-only", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        const fixture = discountFixture();

        const seedLegacyDiscountedAttempt = (
          reservationId: string,
          state: "created" | "pending"
        ) =>
          Effect.gen(function* () {
            yield* seedReservation(reservationId);
            const attemptId = `${reservationId}-attempt`;
            yield* db.insert(paymentAttempts).values({
              id: attemptId,
              workspaceReservationId: reservationId,
              provider: "nexi",
              providerOrderId: `${reservationId}-provider-order`,
              admissionVersion: 1,
              securityToken: state === "pending" ? "opaque-session" : null,
              providerRedirectUrl:
                state === "pending" ? "https://provider.invalid/hpp" : null,
              state,
              amountValue: 900,
              amountExponent: 2,
              currency: "CZK",
            });
            const application = fixture.pricing.discounts[0];
            yield* db.insert(discountApplications).values({
              paymentAttemptId: attemptId,
              workspaceReservationId: reservationId,
              sequence: 0,
              publicDiscountId: application.discount.id,
              label: application.discount.label,
              adjustment: application.discount.adjustment,
              productIdentity: { kind: "cowork", tier: "basic" },
              subtotalBeforeValue: application.subtotalBefore.value,
              subtotalBeforeExponent: application.subtotalBefore.exponent,
              subtotalBeforeCurrency: application.subtotalBefore.currency,
              appliedAmountValue: application.amount.value,
              appliedAmountExponent: application.amount.exponent,
              appliedAmountCurrency: application.amount.currency,
              subtotalAfterValue: application.subtotalAfter.value,
              subtotalAfterExponent: application.subtotalAfter.exponent,
              subtotalAfterCurrency: application.subtotalAfter.currency,
              provenance: {
                providerNamespace: "test",
                providerReference: "legacy",
              },
            });
            yield* db
              .update(workspaceReservations)
              .set({
                activePaymentAttemptId: attemptId,
                paymentState: "pending",
              })
              .where(eq(workspaceReservations.id, reservationId));
          });

        const admitLegacy = (
          reservationId: string,
          pricing = fixture.pricing
        ) =>
          repository.admitPaymentStart({
            workspaceReservationId: reservationId,
            checkoutSessionKey: `session-${reservationId}`,
            providerOrderId: `${reservationId}-new-provider-order`,
            acceptedPricing: pricing,
            affirmedPricing: pricing,
            commitment: fixture.commitment,
            locale: "en-US",
            allowNewAdmission: false,
          });

        yield* seedLegacyDiscountedAttempt(
          "legacy-discounted-attached",
          "pending"
        );
        expect((yield* admitLegacy("legacy-discounted-attached")).outcome).toBe(
          "reuse"
        );

        yield* seedLegacyDiscountedAttempt(
          "legacy-discounted-created",
          "created"
        );
        expect((yield* admitLegacy("legacy-discounted-created")).outcome).toBe(
          "reconciling"
        );

        const contradictoryPricing = {
          ...fixture.pricing,
          discounts: [
            {
              ...fixture.pricing.discounts[0],
              amount: money(101),
            },
          ],
        };
        expect(
          yield* admitLegacy("legacy-discounted-created", contradictoryPricing)
        ).toEqual({
          outcome: "pricing_changed",
          reason: "discount_commitment_mismatch",
        });
      })
    );
  });

  test("database fence blocks legacy rollback cleanup of unresolved v2 starts", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("rollback-fence");
        const admission = yield* admit(repository, "rollback-fence");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        const legacyAttemptCleanup = yield* db
          .update(paymentAttempts)
          .set({
            state: "expired",
            failureCode: "legacy_cleanup",
          })
          .where(eq(paymentAttempts.id, admission.attempt.id))
          .pipe(Effect.result);
        expect(legacyAttemptCleanup._tag).toBe("Failure");

        const legacyReservationCleanup = yield* db
          .update(workspaceReservations)
          .set({
            paymentState: "expired",
            failureCode: "legacy_cleanup",
          })
          .where(eq(workspaceReservations.id, "rollback-fence"))
          .pipe(Effect.result);
        expect(legacyReservationCleanup._tag).toBe("Failure");
        for (const reservationState of [
          "hold_expired",
          "cancelling",
          "cancelled",
        ] as const) {
          expect(
            (yield* db
              .update(workspaceReservations)
              .set({ reservationState })
              .where(eq(workspaceReservations.id, "rollback-fence"))
              .pipe(Effect.result))._tag
          ).toBe("Failure");
        }

        expect(
          yield* repository.markTerminal({
            id: admission.attempt.id,
            workspaceReservationId: "rollback-fence",
            state: "expired",
            failureCode: "verified_cleanup",
            providerStatus: "verified_absent",
          })
        ).toMatchObject({ changed: true });
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ reservationState: "hold_expired" })
            .where(eq(workspaceReservations.id, "rollback-fence"))
            .returning({
              reservationState: workspaceReservations.reservationState,
            }))[0]
        ).toEqual({ reservationState: "hold_expired" });

        yield* seedReservation("provider-start-failure-fence");
        const failedStart = yield* admit(
          repository,
          "provider-start-failure-fence"
        );
        expect(failedStart.outcome).toBe("created");
        if (failedStart.outcome !== "created") return;
        expect(
          yield* repository.markProviderStartFailed({
            id: failedStart.attempt.id,
            workspaceReservationId: "provider-start-failure-fence",
            providerStartLeaseId: failedStart.providerStartLeaseId,
            failureCode: "definitive_provider_rejection",
            providerStatus: "definitive_rejection",
          })
        ).toMatchObject({ outcome: "settled" });

        yield* seedReservation("rollback-attached");
        const discounted = discountFixture();
        const attachedAdmission = yield* admit(
          repository,
          "rollback-attached",
          {
            commitment: discounted.commitment,
            acceptedPricing: discounted.pricing,
            affirmedPricing: discounted.pricing,
          }
        );
        expect(attachedAdmission.outcome).toBe("created");
        if (attachedAdmission.outcome !== "created") return;
        expect(
          yield* repository.attachProviderSession({
            id: attachedAdmission.attempt.id,
            workspaceReservationId: "rollback-attached",
            checkoutSessionKey: "session-rollback-attached",
            providerOrderId: "provider-order-rollback-attached",
            providerStartLeaseId: attachedAdmission.providerStartLeaseId,
            securityToken: "synthetic-session-marker",
            providerRedirectUrl: "https://provider.invalid/session",
          })
        ).toMatchObject({ outcome: "attached" });

        const legacySameTotalReader = yield* db.execute(sql`
          select attempt.id
          from payment_attempts attempt
          join workspace_reservations reservation
            on reservation.id = attempt.workspace_reservation_id
          where attempt.id = ${attachedAdmission.attempt.id}
            and reservation.active_payment_attempt_id = attempt.id
            and reservation.payment_state = 'pending'
            and attempt.state in ('created', 'pending')
            and attempt.security_token is not null
            and attempt.provider_redirect_url is not null
            and attempt.amount_value = ${discounted.pricing.total.value}
        `);
        expect(legacySameTotalReader.rows).toHaveLength(1);

        const contradictoryPricing = {
          ...discounted.pricing,
          fingerprint: "same-total-different-discount-identity",
          discounts: [
            {
              ...discounted.pricing.discounts[0],
              discount: {
                ...discounted.pricing.discounts[0].discount,
                id: Schema.decodeUnknownSync(discountIdSchema)(
                  "different-displayed-discount"
                ),
                label: "Different displayed discount",
              },
            },
          ],
        };
        expect(
          yield* admit(repository, "rollback-attached", {
            commitment: discounted.commitment,
            acceptedPricing: contradictoryPricing,
            affirmedPricing: contradictoryPricing,
            allowNewAdmission: false,
          })
        ).toMatchObject({ outcome: "pricing_changed" });

        expect(
          (yield* db
            .update(paymentAttempts)
            .set({ state: "expired", failureCode: "legacy_cleanup" })
            .where(eq(paymentAttempts.id, attachedAdmission.attempt.id))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ paymentState: "expired", failureCode: "legacy_cleanup" })
            .where(eq(workspaceReservations.id, "rollback-attached"))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
      })
    );
  });

  test("records normalized provider evidence conflicts idempotently", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("evidence-conflict");
        const admission = yield* admit(repository, "evidence-conflict");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        const input = {
          id: admission.attempt.id,
          workspaceReservationId: "evidence-conflict",
          conflictCodes: [
            "provider_order_identity",
            "provider_amount",
            "provider_order_identity",
          ] as const,
        };
        yield* repository.recordEvidenceConflict(input);
        yield* repository.recordEvidenceConflict(input);

        expect(
          yield* db
            .select({
              conflictCode: paymentEvidenceConflicts.conflictCode,
            })
            .from(paymentEvidenceConflicts)
            .where(
              eq(
                paymentEvidenceConflicts.paymentAttemptId,
                admission.attempt.id
              )
            )
        ).toEqual([
          { conflictCode: "provider_order_identity" },
          { conflictCode: "provider_amount" },
        ]);
      })
    );
  });

  test("rejects stale reconciliation conflict materialization after every cancellation takeover state", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        for (const reservationState of [
          "hold_expired",
          "cancelling",
          "cancelled",
        ] as const) {
          const reservationId = `expired-conflict-claim-${reservationState}`;
          yield* seedReservation(reservationId);
          const admission = yield* admit(repository, reservationId);
          expect(admission.outcome).toBe("created");
          if (admission.outcome !== "created") continue;

          yield* repository.markTerminal({
            id: admission.attempt.id,
            workspaceReservationId: reservationId,
            state: "failed",
            failureCode: "nexi_payment_failed",
            providerOperationId: "original-operation",
            providerStatus: "DECLINED",
          });
          const claim = yield* repository.claimProviderReconciliation({
            id: admission.attempt.id,
            workspaceReservationId: reservationId,
          });
          expect(claim.outcome).toBe("claimed");
          if (claim.outcome !== "claimed") continue;

          yield* db
            .update(workspaceReservations)
            .set({
              paymentReconciliationClaimExpiresAt: sql`clock_timestamp() - interval '1 second'`,
            })
            .where(eq(workspaceReservations.id, reservationId));
          yield* db
            .update(workspaceReservations)
            .set({ reservationState })
            .where(eq(workspaceReservations.id, reservationId));

          expect(
            (yield* repository
              .recordEvidenceConflict({
                id: admission.attempt.id,
                workspaceReservationId: reservationId,
                reconciliationClaimId: claim.claimId,
                conflictCodes: ["provider_terminal_state"],
              })
              .pipe(Effect.result))._tag
          ).toBe("Failure");
          expect(
            yield* db
              .select()
              .from(paymentEvidenceConflicts)
              .where(
                eq(
                  paymentEvidenceConflicts.paymentAttemptId,
                  admission.attempt.id
                )
              )
          ).toHaveLength(0);
        }
      })
    );
  });

  test("atomically reacquires an expired reconciliation claim before materializing the fence", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("reacquired-conflict-claim");
        const admission = yield* admit(repository, "reacquired-conflict-claim");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        const claim = yield* repository.claimProviderReconciliation({
          id: admission.attempt.id,
          workspaceReservationId: "reacquired-conflict-claim",
        });
        expect(claim.outcome).toBe("claimed");
        if (claim.outcome !== "claimed") return;

        yield* db
          .update(workspaceReservations)
          .set({
            paymentReconciliationClaimExpiresAt: sql`clock_timestamp() - interval '1 second'`,
          })
          .where(eq(workspaceReservations.id, "reacquired-conflict-claim"));

        yield* repository.recordEvidenceConflict({
          id: admission.attempt.id,
          workspaceReservationId: "reacquired-conflict-claim",
          reconciliationClaimId: claim.claimId,
          conflictCodes: ["provider_terminal_state"],
        });

        expect(
          yield* db
            .select({
              evidenceConflicted:
                workspaceReservations.activePaymentEvidenceConflicted,
              reconciliationAttemptId:
                workspaceReservations.paymentReconciliationAttemptId,
              reconciliationClaimId:
                workspaceReservations.paymentReconciliationClaimId,
              reconciliationClaimExpiresAt:
                workspaceReservations.paymentReconciliationClaimExpiresAt,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, "reacquired-conflict-claim"))
        ).toEqual([
          {
            evidenceConflicted: true,
            reconciliationAttemptId: null,
            reconciliationClaimId: null,
            reconciliationClaimExpiresAt: null,
          },
        ]);
      })
    );
  });

  test("preserves a conflicted terminal active attempt and rejects replacement admission", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("conflicted-terminal-retry");
        const admission = yield* admit(repository, "conflicted-terminal-retry");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        yield* repository.markTerminal({
          id: admission.attempt.id,
          workspaceReservationId: "conflicted-terminal-retry",
          state: "failed",
          failureCode: "authoritative_provider_failure",
          providerOperationId: "terminal-operation",
          providerStatus: "DECLINED",
        });
        yield* repository.recordEvidenceConflict({
          id: admission.attempt.id,
          workspaceReservationId: "conflicted-terminal-retry",
          conflictCodes: ["provider_operation_evidence"],
        });

        const retry = yield* admit(repository, "conflicted-terminal-retry", {
          allowNewAdmission: true,
        });
        expect(retry).toEqual({
          outcome: "unavailable",
          reason: "active_attempt",
        });

        const attempts = yield* db
          .select({
            id: paymentAttempts.id,
            state: paymentAttempts.state,
            evidenceConflicted: paymentAttempts.providerEvidenceConflicted,
          })
          .from(paymentAttempts)
          .where(
            eq(
              paymentAttempts.workspaceReservationId,
              "conflicted-terminal-retry"
            )
          );
        expect(attempts).toEqual([
          {
            id: admission.attempt.id,
            state: "failed",
            evidenceConflicted: true,
          },
        ]);

        const [reservationRow] = yield* db
          .select({
            activeAttemptId: workspaceReservations.activePaymentAttemptId,
            paymentState: workspaceReservations.paymentState,
            evidenceConflicted:
              workspaceReservations.activePaymentEvidenceConflicted,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "conflicted-terminal-retry"));
        expect(reservationRow).toEqual({
          activeAttemptId: admission.attempt.id,
          paymentState: "failed",
          evidenceConflicted: true,
        });

        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ activePaymentAttemptId: null })
            .where(eq(workspaceReservations.id, "conflicted-terminal-retry"))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
      })
    );
  });

  test("fences paid and terminal settlement after durable provider evidence conflict", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        const fixture = claimFixture("conflict-fence");
        yield* seedReservation("conflict-fence", undefined, fixture.customerId);
        yield* seedClaimConfiguration(fixture);
        const admission = yield* admit(repository, "conflict-fence", fixture);
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        yield* repository.recordEvidenceConflict({
          id: admission.attempt.id,
          workspaceReservationId: "conflict-fence",
          conflictCodes: ["provider_order_identity"],
        });

        expect(
          yield* repository
            .markProviderStartFailed({
              id: admission.attempt.id,
              workspaceReservationId: "conflict-fence",
              providerStartLeaseId: admission.providerStartLeaseId,
              failureCode: "definitive_provider_rejection",
              providerStatus: "definitive_rejection",
            })
            .pipe(Effect.result)
        ).toMatchObject({
          _tag: "Failure",
          failure: { reason: "provider_evidence_conflict" },
        });

        expect(
          (yield* db
            .update(paymentAttempts)
            .set({
              state: "paid",
              providerEvidenceConflicted: false,
            })
            .where(eq(paymentAttempts.id, admission.attempt.id))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(paymentAttempts)
            .set({
              state: "failed",
              failureCode: "legacy_provider_failure",
            })
            .where(eq(paymentAttempts.id, admission.attempt.id))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({
              paymentState: "paid",
              activePaymentEvidenceConflicted: false,
            })
            .where(eq(workspaceReservations.id, "conflict-fence"))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ paymentState: "paid" })
            .where(eq(workspaceReservations.id, "conflict-fence"))
            .pipe(Effect.result))._tag
        ).toBe("Failure");

        const paidResult = yield* repository
          .markPaid({
            id: admission.attempt.id,
            workspaceReservationId: "conflict-fence",
            providerOperationId: "later-success",
            providerStatus: "EXECUTED",
            paidAt: Temporal.Instant.from("2026-07-25T00:00:00Z"),
          })
          .pipe(Effect.result);
        const terminalResult = yield* repository
          .markTerminal({
            id: admission.attempt.id,
            workspaceReservationId: "conflict-fence",
            state: "failed",
            failureCode: "nexi_payment_failed",
            providerOperationId: "later-failure",
            providerStatus: "DECLINED",
          })
          .pipe(Effect.result);

        expect(paidResult).toMatchObject({
          _tag: "Failure",
          failure: { reason: "provider_evidence_conflict" },
        });
        expect(terminalResult).toMatchObject({
          _tag: "Failure",
          failure: { reason: "provider_evidence_conflict" },
        });
        expect(
          (yield* db
            .select({
              state: paymentAttempts.state,
              operationId: paymentAttempts.lastProviderOperationId,
              providerStatus: paymentAttempts.lastProviderStatus,
              providerStartLeaseId: paymentAttempts.providerStartLeaseId,
              providerEvidenceConflicted:
                paymentAttempts.providerEvidenceConflicted,
            })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, admission.attempt.id)))[0]
        ).toEqual({
          state: "created",
          operationId: null,
          providerStatus: null,
          providerStartLeaseId: admission.providerStartLeaseId,
          providerEvidenceConflicted: true,
        });
        expect(
          (yield* db
            .select({
              paymentState: workspaceReservations.paymentState,
              reservationState: workspaceReservations.reservationState,
              fulfillmentState: workspaceReservations.fulfillmentState,
              paidAt: workspaceReservations.paidAt,
              activePaymentEvidenceConflicted:
                workspaceReservations.activePaymentEvidenceConflicted,
            })
            .from(workspaceReservations)
            .where(eq(workspaceReservations.id, "conflict-fence")))[0]
        ).toEqual({
          paymentState: "pending",
          reservationState: "held",
          fulfillmentState: "not_started",
          paidAt: null,
          activePaymentEvidenceConflicted: true,
        });
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(0);
        expect(
          (yield* db
            .select({ state: discountCodeRedemptions.state })
            .from(discountCodeRedemptions)
            .where(
              eq(discountCodeRedemptions.paymentAttemptId, admission.attempt.id)
            ))[0]
        ).toEqual({ state: "reserved" });
      })
    );
  });

  test("digests oversized operation identity before settlement persistence", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("bounded-operation");
        const admission = yield* admit(repository, "bounded-operation");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        const oversizedOperationId = randomUUID().repeat(12);
        yield* repository.markPaid({
          id: admission.attempt.id,
          workspaceReservationId: "bounded-operation",
          providerOperationId: oversizedOperationId,
          providerStatus: "EXECUTED",
          paidAt: Temporal.Now.instant(),
        });

        const [persisted] = yield* db
          .select({
            providerOperationId: paymentAttempts.lastProviderOperationId,
          })
          .from(paymentAttempts)
          .where(eq(paymentAttempts.id, admission.attempt.id));
        expect(persisted?.providerOperationId).toMatch(
          /^provider-operation:[a-f0-9]{64}$/
        );
        expect(persisted?.providerOperationId).not.toContain(
          oversizedOperationId
        );
      })
    );
  });

  test("database conflict fence rejects same-terminal legacy replays", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;

        yield* seedReservation("conflicted-paid-replay");
        const paidAdmission = yield* admit(
          repository,
          "conflicted-paid-replay"
        );
        expect(paidAdmission.outcome).toBe("created");
        if (paidAdmission.outcome !== "created") return;
        yield* repository.markPaid({
          id: paidAdmission.attempt.id,
          workspaceReservationId: "conflicted-paid-replay",
          paidAt: Temporal.Instant.from("2026-07-25T00:00:00Z"),
        });
        yield* repository.recordEvidenceConflict({
          id: paidAdmission.attempt.id,
          workspaceReservationId: "conflicted-paid-replay",
          conflictCodes: ["provider_terminal_state"],
        });
        yield* db.delete(paymentPaidEvents);

        expect(
          (yield* db
            .update(paymentAttempts)
            .set({ state: "paid" })
            .where(eq(paymentAttempts.id, paidAdmission.attempt.id))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ paymentState: "paid" })
            .where(eq(workspaceReservations.id, "conflicted-paid-replay"))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(0);

        yield* seedReservation("conflicted-terminal-replay");
        const terminalAdmission = yield* admit(
          repository,
          "conflicted-terminal-replay"
        );
        expect(terminalAdmission.outcome).toBe("created");
        if (terminalAdmission.outcome !== "created") return;
        yield* repository.markTerminal({
          id: terminalAdmission.attempt.id,
          workspaceReservationId: "conflicted-terminal-replay",
          state: "failed",
          failureCode: "verified_failure",
        });
        yield* repository.recordEvidenceConflict({
          id: terminalAdmission.attempt.id,
          workspaceReservationId: "conflicted-terminal-replay",
          conflictCodes: ["provider_terminal_state"],
        });

        expect(
          (yield* db
            .update(paymentAttempts)
            .set({ state: "failed" })
            .where(eq(paymentAttempts.id, terminalAdmission.attempt.id))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .update(workspaceReservations)
            .set({ paymentState: "failed" })
            .where(eq(workspaceReservations.id, "conflicted-terminal-replay"))
            .pipe(Effect.result))._tag
        ).toBe("Failure");
      })
    );
  });

  test("database conflict fence rejects automatic hold cancellation transitions after terminal settlement", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        const reservations = yield* WorkspaceReservationRepository;

        for (const reservationState of [
          "hold_expired",
          "cancelling",
          "cancelled",
        ] as const) {
          const reservationId = `conflicted-${reservationState}`;
          yield* seedReservation(reservationId);
          const admission = yield* admit(repository, reservationId);
          expect(admission.outcome).toBe("created");
          if (admission.outcome !== "created") continue;

          yield* repository.markTerminal({
            id: admission.attempt.id,
            workspaceReservationId: reservationId,
            state: "failed",
            failureCode: "authoritative_provider_failure",
            providerOperationId: "terminal-operation",
            providerStatus: "DECLINED",
          });
          yield* repository.recordEvidenceConflict({
            id: admission.attempt.id,
            workspaceReservationId: reservationId,
            conflictCodes: ["provider_terminal_state"],
          });
          yield* db
            .update(workspaceReservations)
            .set({
              reservationHoldExpiresAt: sql`clock_timestamp() - interval '1 second'`,
            })
            .where(eq(workspaceReservations.id, reservationId));

          expect(
            yield* reservations.selectExpiredHoldDotyposReservationIds({
              now: Temporal.Now.instant(),
            })
          ).not.toContain(`provider-${reservationId}`);

          expect(
            (yield* db
              .update(workspaceReservations)
              .set({ reservationState })
              .where(eq(workspaceReservations.id, reservationId))
              .pipe(Effect.result))._tag
          ).toBe("Failure");
          expect(
            (yield* db
              .select({
                reservationState: workspaceReservations.reservationState,
                evidenceConflicted:
                  workspaceReservations.activePaymentEvidenceConflicted,
              })
              .from(workspaceReservations)
              .where(eq(workspaceReservations.id, reservationId)))[0]
          ).toEqual({
            reservationState: "held",
            evidenceConflicted: true,
          });
        }
      })
    );
  });

  test("rolls back the attempt, link, and applications when materialization persistence fails", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("rollback");
        yield* db.execute(
          sql.raw(`
          create function reject_application() returns trigger
          language plpgsql as 'begin
            raise exception ''synthetic application persistence failure'';
          end'
        `)
        );
        yield* db.execute(
          sql.raw(`
          create trigger reject_application
          before insert on discount_applications
          for each row execute function reject_application()
        `)
        );
        const { commitment, pricing } = discountFixture();

        expect(
          (yield* admit(repository, "rollback", {
            commitment,
            acceptedPricing: pricing,
            affirmedPricing: pricing,
          }).pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(yield* db.select().from(paymentAttempts)).toHaveLength(0);
        expect(yield* db.select().from(discountApplications)).toHaveLength(0);
        const [reservation] = yield* db
          .select({
            paymentState: workspaceReservations.paymentState,
            activePaymentAttemptId:
              workspaceReservations.activePaymentAttemptId,
          })
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, "rollback"));
        expect(reservation).toMatchObject({
          paymentState: "not_started",
          activePaymentAttemptId: null,
        });
      })
    );
  });

  test("persists exact displayed pricing and guards the provider order on attach", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("materialized");
        const { commitment, pricing, publicDiscountId } = discountFixture();
        const admission = yield* admit(repository, "materialized", {
          commitment,
          acceptedPricing: pricing,
          affirmedPricing: pricing,
        });
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        const [attempt] = yield* db.select().from(paymentAttempts);
        const [application] = yield* db.select().from(discountApplications);
        expect(attempt).toMatchObject({
          pricingFingerprint: pricing.fingerprint,
          displayedDiscountIds: [publicDiscountId],
          amountValue: pricing.total.value,
          currency: pricing.total.currency,
        });
        expect(application).toMatchObject({
          publicDiscountId,
          label: "Displayed discount",
          appliedAmountCurrency: "CZK",
        });
        const changedPricing = {
          ...pricing,
          fingerprint: "changed-pricing-fingerprint",
        };
        expect(
          (yield* admit(repository, "materialized", {
            commitment,
            acceptedPricing: changedPricing,
            affirmedPricing: changedPricing,
          })).outcome
        ).toBe("pricing_changed");
        expect(
          (yield* repository.attachProviderSession({
            id: admission.attempt.id,
            workspaceReservationId: "materialized",
            checkoutSessionKey: "session-materialized",
            providerOrderId: "wrong-provider-order",
            providerStartLeaseId: admission.providerStartLeaseId,
            securityToken: "non-secret-test-token",
            providerRedirectUrl: "https://provider.example/hosted",
          })).outcome
        ).toBe("lost");
      })
    );
  });

  test("reserves, redeems, and releases claims idempotently with paid enqueue", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        const paidFixture = claimFixture("paid");
        yield* seedReservation("paid", undefined, paidFixture.customerId);
        yield* seedClaimConfiguration(paidFixture);
        const paidAdmission = yield* admit(repository, "paid", paidFixture);
        expect(paidAdmission.outcome).toBe("created");
        if (paidAdmission.outcome !== "created") return;
        expect(
          (yield* db.select().from(discountCodeRedemptions))[0]
        ).toMatchObject({ state: "reserved" });

        const paidAt = Temporal.Instant.from("2026-07-25T00:00:00Z");
        expect(
          (yield* repository.markPaid({
            id: paidAdmission.attempt.id,
            workspaceReservationId: "paid",
            providerOperationId: "operation-paid",
            providerStatus: "EXECUTED",
            paidAt,
          })).changed
        ).toBeTrue();
        expect(
          (yield* repository.markPaid({
            id: paidAdmission.attempt.id,
            workspaceReservationId: "paid",
            providerOperationId: "operation-paid",
            providerStatus: "EXECUTED",
            paidAt: paidAt.add({ seconds: 1 }),
          })).changed
        ).toBeFalse();
        expect(
          (yield* repository
            .markPaid({
              id: paidAdmission.attempt.id,
              workspaceReservationId: "paid",
              providerOperationId: "different-operation",
              providerStatus: "EXECUTED",
              paidAt: paidAt.add({ seconds: 2 }),
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .select({
              operationId: paymentAttempts.lastProviderOperationId,
              status: paymentAttempts.lastProviderStatus,
            })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, paidAdmission.attempt.id)))[0]
        ).toEqual({
          operationId: "operation-paid",
          status: "EXECUTED",
        });
        expect(
          (yield* repository
            .markPaid({
              id: paidAdmission.attempt.id,
              workspaceReservationId: "paid",
              providerOperationId: "operation-paid",
              providerStatus: "CAPTURED",
              paidAt: paidAt.add({ seconds: 3 }),
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db.select().from(discountCodeRedemptions))[0]
        ).toMatchObject({ state: "redeemed" });
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(1);

        const terminalFixture = claimFixture("terminal");
        yield* seedReservation(
          "terminal",
          undefined,
          terminalFixture.customerId
        );
        yield* seedClaimConfiguration(terminalFixture);
        const terminalAdmission = yield* admit(
          repository,
          "terminal",
          terminalFixture
        );
        expect(terminalAdmission.outcome).toBe("created");
        if (terminalAdmission.outcome !== "created") return;
        expect(
          (yield* repository.markTerminal({
            id: terminalAdmission.attempt.id,
            workspaceReservationId: "terminal",
            state: "expired",
            failureCode: "test_expired",
            providerOperationId: "operation-terminal",
            providerStatus: "DECLINED",
          })).changed
        ).toBeTrue();
        expect(
          (yield* repository.markTerminal({
            id: terminalAdmission.attempt.id,
            workspaceReservationId: "terminal",
            state: "expired",
            failureCode: "test_expired",
            providerOperationId: "operation-terminal",
            providerStatus: "DECLINED",
          })).changed
        ).toBeFalse();
        expect(
          (yield* repository
            .markTerminal({
              id: terminalAdmission.attempt.id,
              workspaceReservationId: "terminal",
              state: "expired",
              failureCode: "test_expired",
              providerOperationId: "different-operation",
              providerStatus: "DECLINED",
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .select({
              operationId: paymentAttempts.lastProviderOperationId,
              status: paymentAttempts.lastProviderStatus,
            })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.id, terminalAdmission.attempt.id)))[0]
        ).toEqual({
          operationId: "operation-terminal",
          status: "DECLINED",
        });
        expect(
          (yield* repository
            .markTerminal({
              id: terminalAdmission.attempt.id,
              workspaceReservationId: "terminal",
              state: "expired",
              failureCode: "test_expired",
              providerOperationId: "operation-terminal",
              providerStatus: "VOIDED",
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* repository
            .markTerminal({
              id: terminalAdmission.attempt.id,
              workspaceReservationId: "terminal",
              state: "failed",
              failureCode: "test_expired",
              providerOperationId: "operation-terminal",
              providerStatus: "DECLINED",
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* repository
            .markTerminal({
              id: terminalAdmission.attempt.id,
              workspaceReservationId: "terminal",
              state: "expired",
              failureCode: "different_failure",
              providerOperationId: "operation-terminal",
              providerStatus: "DECLINED",
            })
            .pipe(Effect.result))._tag
        ).toBe("Failure");
        expect(
          (yield* db
            .select()
            .from(discountCodeRedemptions)
            .where(
              eq(
                discountCodeRedemptions.paymentAttemptId,
                terminalAdmission.attempt.id
              )
            ))[0]
        ).toMatchObject({ state: "released" });
        const paidToTerminalConflict = yield* repository
          .markTerminal({
            id: paidAdmission.attempt.id,
            workspaceReservationId: "paid",
            state: "expired",
            failureCode: "stale_cleanup",
          })
          .pipe(Effect.flip);
        expect(paidToTerminalConflict).toBeInstanceOf(
          PaymentLifecycleStateError
        );
        expect(paidToTerminalConflict).toMatchObject({
          reason: "provider_evidence_conflict",
        });

        const terminalToPaidConflict = yield* repository
          .markPaid({
            id: terminalAdmission.attempt.id,
            workspaceReservationId: "terminal",
            paidAt: paidAt.add({ seconds: 4 }),
          })
          .pipe(Effect.flip);
        expect(terminalToPaidConflict).toMatchObject({
          reason: "provider_evidence_conflict",
        });
      })
    );
  });

  test("database bridge covers legacy paid writers, rollback, backfill, and replay repair", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* PaymentLifecycleRepository;
        yield* seedReservation("legacy-paid");
        const admission = yield* admit(repository, "legacy-paid");
        expect(admission.outcome).toBe("created");
        if (admission.outcome !== "created") return;

        const rolledBack = yield* db
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* tx
                .update(paymentAttempts)
                .set({ state: "paid" })
                .where(eq(paymentAttempts.id, admission.attempt.id));
              yield* tx
                .update(workspaceReservations)
                .set({
                  paymentState: "paid",
                  paidAt: Temporal.Instant.from("2026-07-25T01:00:00Z"),
                })
                .where(eq(workspaceReservations.id, "legacy-paid"));
              return yield* Effect.fail("intentional_rollback");
            })
          )
          .pipe(Effect.result);
        expect(rolledBack._tag).toBe("Failure");
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(0);

        const paidAt = Temporal.Instant.from("2026-07-25T02:00:00Z");
        yield* db.transaction((tx) =>
          Effect.gen(function* () {
            yield* tx
              .update(paymentAttempts)
              .set({ state: "paid" })
              .where(eq(paymentAttempts.id, admission.attempt.id));
            yield* tx
              .update(workspaceReservations)
              .set({ paymentState: "paid", paidAt })
              .where(eq(workspaceReservations.id, "legacy-paid"));
          })
        );
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(1);

        yield* db.delete(paymentPaidEvents);
        yield* db.execute(reconcilePaidEvents);
        yield* db.execute(reconcilePaidEvents);
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(1);

        yield* db.delete(paymentPaidEvents);
        expect(
          (yield* repository.markPaid({
            id: admission.attempt.id,
            workspaceReservationId: "legacy-paid",
            paidAt: paidAt.add({ seconds: 1 }),
          })).changed
        ).toBeFalse();
        expect(yield* db.select().from(paymentPaidEvents)).toHaveLength(1);
      })
    );
  });
});

const discountFixture = () => {
  const publicDiscountId =
    Schema.decodeUnknownSync(discountIdSchema)("displayed-discount");
  const application = {
    discount: {
      id: publicDiscountId,
      label: "Displayed discount",
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
    },
    subtotalBefore: money(1000),
    amount: money(100),
    subtotalAfter: money(900),
  };
  return {
    publicDiscountId,
    pricing: {
      fingerprint: "discounted-fingerprint",
      total: money(900),
      discounts: [application],
    },
    commitment: makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "test",
              providerReference: "discount-reference",
            },
          },
        },
      ],
    }),
  };
};

const claimFixture = (suffix: string) => {
  const storedDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
    suffix === "paid"
      ? "019d2635-7d88-7000-8000-000000000001"
      : "019d2635-7d88-7000-8000-000000000002"
  );
  const codeId = Schema.decodeUnknownSync(discountCodeIdSchema)(
    `code-${suffix}`
  );
  const customerId = Schema.decodeUnknownSync(dotyposCustomerIdSchema)(
    `customer-${suffix}`
  );
  const publicDiscountId = Schema.decodeUnknownSync(discountIdSchema)(
    `displayed-${suffix}`
  );
  const application = {
    discount: {
      id: publicDiscountId,
      label: "Claimed discount",
      adjustment: { kind: "percentage" as const, basisPoints: 1000 },
    },
    subtotalBefore: money(1000),
    amount: money(100),
    subtotalAfter: money(900),
  };
  const pricing = {
    fingerprint: `claim-${suffix}-fingerprint`,
    total: money(900),
    discounts: [application],
  };
  return {
    storedDiscountId,
    codeId,
    customerId,
    acceptedPricing: pricing,
    affirmedPricing: pricing,
    commitment: makeDiscountCommitment({
      product: { kind: "cowork", tier: "basic" },
      applications: [
        {
          application,
          candidate: {
            discount: application.discount,
            provenance: {
              providerNamespace: "discount_code",
              providerReference: `reference-${suffix}`,
            },
            claim: {
              kind: "discount_code",
              codeId,
              storedDiscountId,
              dotyposCustomerId: customerId,
              product: { kind: "cowork", tier: "basic" },
            },
          },
        },
      ],
    }),
  };
};

const seedClaimConfiguration = (fixture: ReturnType<typeof claimFixture>) =>
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;
    yield* db.execute(sql`
      insert into discounts (
        id,
        labels,
        percentage_basis_points
      ) values (
        ${fixture.storedDiscountId},
        ${JSON.stringify({
          "en-US": "Claimed discount",
          "cs-CZ": "Claimed discount",
        })}::jsonb,
        1000
      )
    `);
    yield* db.execute(sql`
      insert into discount_product_targets (
        discount_id,
        product_identity
      ) values (
        ${fixture.storedDiscountId},
        ${JSON.stringify({ kind: "cowork", tier: "basic" })}::jsonb
      )
    `);
    yield* db.execute(sql`
      insert into discount_codes (
        id,
        discount_id,
        code,
        enabled
      ) values (
        ${fixture.codeId},
        ${fixture.storedDiscountId},
        ${`CODE-${fixture.codeId.toUpperCase()}`},
        true
      )
    `);
  });
