import "@/shared/polyfills/temporal";
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
  getDifferentProviderAttachmentRecovery,
  getHoldCreationMarker,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
  WorkspaceReservationStateError,
} from "./workspace-reservation.repository";

const readRepository = () =>
  Bun.file(
    new URL("./workspace-reservation.repository.ts", import.meta.url)
  ).text();

const sliceFrom = (source: string, startNeedle: string, endNeedle: string) => {
  const start = source.indexOf(startNeedle);
  const end = source.indexOf(endNeedle, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

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

describe("WorkspaceReservationRepository", () => {
  test.each([
    ["draft", null],
    ["draft", "hold_creation_pre_provider_retired"],
    ["creating_hold", "hold_creation_pre_provider:synthetic-retirement-epoch"],
  ] as const)("atomically retires a prior %s attempt before any provider-boundary claim", async (reservationState, failureCode) => {
    const row = {
      id: `synthetic-retirement-${reservationState}`,
      checkoutAttemptKey: `synthetic-retirement-${reservationState}-attempt`,
      reservationState,
      paymentState: "not_started",
      activePaymentAttemptId: null,
      dotyposReservationId: null,
      failureCode,
    };
    const update = () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () =>
            Effect.sync(() => {
              const isRetirement =
                values.failureCode === "hold_creation_pre_provider_retired";
              const isCreationClaim =
                values.reservationState === "creating_hold" &&
                typeof values.failureCode === "string" &&
                values.failureCode.startsWith("hold_creation_pre_provider:");
              if (
                isRetirement &&
                row.paymentState === "not_started" &&
                row.activePaymentAttemptId === null &&
                row.dotyposReservationId === null &&
                ((row.reservationState === "draft" &&
                  (row.failureCode === null ||
                    row.failureCode ===
                      "hold_creation_pre_provider_retired")) ||
                  (row.reservationState === "creating_hold" &&
                    row.failureCode?.startsWith("hold_creation_pre_provider:")))
              ) {
                Object.assign(row, values);
                return [{ id: row.id }];
              }
              if (
                isCreationClaim &&
                row.reservationState === "draft" &&
                row.failureCode === null
              ) {
                Object.assign(row, values);
                return [{ id: row.id }];
              }
              return [];
            }),
        }),
      }),
    });
    const program = Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const retired = yield* repository.retirePreProviderDraft({
        id: row.id,
        checkoutAttemptKey: row.checkoutAttemptKey,
      });
      const laterCreationClaim = yield* repository.claimHoldCreation(row.id);
      return { retired, laterCreationClaim };
    }).pipe(
      Effect.provide(
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, {
              db: { update } as never,
            })
          )
        )
      )
    );

    const result = await Effect.runPromise(program);

    expect(result).toEqual({
      retired: true,
      laterCreationClaim: null,
    });
    expect(row).toMatchObject({
      reservationState: "draft",
      failureCode: "hold_creation_pre_provider_retired",
      dotyposReservationId: null,
    });
  });

  test("attaches an exact pre-attachment candidate without refreshing its persisted deadline", async () => {
    const epoch = "synthetic-partial-candidate-epoch";
    const providerId = "synthetic-partial-candidate-provider";
    const providerCreatedAt = Temporal.Instant.from("2026-06-01T10:00:00Z");
    const originalDeadline = Temporal.Instant.from("2026-06-01T10:10:00Z");
    const row = {
      id: "synthetic-partial-candidate-reservation",
      reservationState: "creating_hold",
      paymentState: "not_started",
      dotyposReservationId: providerId,
      reservationCreatedAt: providerCreatedAt,
      reservationHoldExpiresAt: originalDeadline,
      failureCode: `hold_creation_candidate:${epoch}:${providerId}:${providerCreatedAt.epochMilliseconds}`,
    };
    const update = () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () =>
            Effect.sync(() => {
              if (
                row.reservationState !== "creating_hold" ||
                row.dotyposReservationId !== providerId ||
                !row.reservationCreatedAt.equals(providerCreatedAt) ||
                row.failureCode !==
                  `hold_creation_candidate:${epoch}:${providerId}:${providerCreatedAt.epochMilliseconds}`
              ) {
                return [];
              }
              Object.assign(row, values);
              return [{ id: row.id }];
            }),
        }),
      }),
    });
    const program = Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      yield* repository.attachHold({
        id: row.id,
        epoch,
        dotyposReservationId: providerId,
        reservationCreatedAt: providerCreatedAt,
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, {
              db: { update } as never,
            })
          )
        )
      )
    );

    await Effect.runPromise(program);

    expect(row).toMatchObject({
      reservationState: "held",
      dotyposReservationId: providerId,
      reservationHoldExpiresAt: originalDeadline,
    });
    expect(row.reservationCreatedAt.equals(providerCreatedAt)).toBe(true);
    expect(
      row.failureCode.startsWith(
        `hold_creation_candidate:${epoch}:${providerId}:${providerCreatedAt.epochMilliseconds}:`
      )
    ).toBe(true);
  });

  test("promotes queue-only exact evidence from a plain compensation marker idempotently", async () => {
    const epoch = "synthetic-queue-only-epoch";
    const providerId = "synthetic-queue-only-provider";
    const createdAt = Temporal.Instant.from("2026-06-01T10:00:00Z");
    const row = {
      id: "synthetic-queue-only-reservation",
      reservationState: "creating_hold",
      failureCode: `hold_creation_compensating:${epoch}`,
      dotyposReservationId: null as string | null,
      reservationCreatedAt: null as Temporal.Instant | null,
      updatedAt: Temporal.Instant.from("2026-06-01T09:59:00Z"),
    };
    const update = () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () =>
            Effect.sync(() => {
              if (
                row.reservationState !== "creating_hold" ||
                row.failureCode !== `hold_creation_compensating:${epoch}` ||
                row.dotyposReservationId !== null ||
                row.reservationCreatedAt !== null
              ) {
                return [];
              }
              Object.assign(row, values);
              return [{ id: row.id }];
            }),
        }),
      }),
    });
    const select = () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed([{ ...row }]),
        }),
      }),
    });
    const program = Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      const input = {
        id: row.id,
        epoch,
        dotyposReservationId: providerId,
        reservationCreatedAt: createdAt,
        failureCode: "attach_failed_cancel_failed" as const,
      };
      yield* repository.markAttachFailedCancellationRequired(input);
      yield* repository.markAttachFailedCancellationRequired(input);
    }).pipe(
      Effect.provide(
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, {
              db: { update, select } as never,
            })
          )
        )
      )
    );

    await Effect.runPromise(program);

    expect(row).toMatchObject({
      reservationState: "cancellation_failed",
      failureCode: `attach_failed_cancel_failed:${epoch}`,
      dotyposReservationId: providerId,
    });
    expect(row.reservationCreatedAt?.equals(createdAt)).toBe(true);
  });

  test("composes candidate attachment and exact different-provider recovery through live repository CAS methods", async () => {
    const epoch = "synthetic-live-composed-epoch";
    const winnerId = "synthetic-live-composed-winner";
    const loserId = "synthetic-live-composed-loser";
    const winnerCreatedAt = Temporal.Instant.from("2026-06-01T10:00:00Z");
    const loserCreatedAt = Temporal.Instant.from("2026-06-01T10:00:01Z");
    const ownerId = "synthetic-live-composed-owner";
    const retryOwnerId = "synthetic-live-composed-retry-owner";
    const row = {
      id: "synthetic-live-composed-reservation",
      reservationState: "creating_hold",
      paymentState: "not_started",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
      dotyposReservationId: null as string | null,
      reservationCreatedAt: null as Temporal.Instant | null,
    };
    const update = () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: () =>
            Effect.sync(() => {
              const failureCode =
                typeof values.failureCode === "string"
                  ? values.failureCode
                  : null;
              const canRecordCandidate =
                failureCode?.startsWith(`hold_creation_candidate:${epoch}:`) &&
                row.reservationState === "creating_hold" &&
                row.failureCode ===
                  `hold_creation_provider_reconciliation:${epoch}` &&
                row.dotyposReservationId === null;
              const canAttach =
                values.reservationState === "held" &&
                failureCode?.startsWith(
                  `hold_creation_candidate:${epoch}:${winnerId}:`
                ) &&
                row.reservationState === "creating_hold" &&
                row.dotyposReservationId === winnerId;
              const canRecordLoser =
                failureCode?.startsWith(
                  `hold_creation_orphan_recovery:${epoch}:${loserId}:`
                ) &&
                row.reservationState === "held" &&
                row.paymentState === "not_started" &&
                row.dotyposReservationId === winnerId &&
                row.failureCode?.startsWith(
                  `hold_creation_candidate:${epoch}:${winnerId}:`
                );
              const canClaimLoser =
                failureCode?.startsWith(
                  `hold_creation_orphan_processing:${epoch}:${loserId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_recovery:${epoch}:${loserId}:`
                );
              const canReleaseLoser =
                failureCode?.startsWith(
                  `hold_creation_orphan_recovery:${epoch}:${loserId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_processing:${epoch}:${loserId}:`
                );
              const canBeginLoserVerification =
                failureCode?.startsWith(
                  `hold_creation_orphan_verifying:${epoch}:${loserId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_processing:${epoch}:${loserId}:`
                );
              const canReleaseLoserVerification =
                failureCode?.startsWith(
                  `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_verifying:${epoch}:${loserId}:`
                );
              const canClaimLoserVerification =
                failureCode?.startsWith(
                  `hold_creation_orphan_verifying:${epoch}:${loserId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:`
                );
              const canResolveLoser =
                failureCode?.startsWith(
                  `hold_creation_candidate:${epoch}:${winnerId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_verifying:${epoch}:${loserId}:`
                ) === true;
              if (
                !canRecordCandidate &&
                !canAttach &&
                !canRecordLoser &&
                !canClaimLoser &&
                !canReleaseLoser &&
                !canBeginLoserVerification &&
                !canReleaseLoserVerification &&
                !canClaimLoserVerification &&
                !canResolveLoser
              ) {
                return [];
              }
              Object.assign(row, values);
              return [{ id: row.id }];
            }),
        }),
      }),
    });
    const select = () => ({
      from: () => ({
        where: () => ({
          limit: () => Effect.succeed([{ ...row }]),
          pipe: (...operations: readonly ((value: unknown) => unknown)[]) =>
            operations.reduce(
              (value, operation) => operation(value),
              Effect.succeed([{ ...row }]) as unknown
            ),
        }),
        pipe: (...operations: readonly ((value: unknown) => unknown)[]) =>
          operations.reduce(
            (value, operation) => operation(value),
            Effect.succeed([{ ...row }]) as unknown
          ),
      }),
    });
    const program = Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      yield* repository.recordProviderHoldCandidate({
        id: row.id,
        epoch,
        dotyposReservationId: winnerId,
        reservationCreatedAt: winnerCreatedAt,
      });
      yield* repository.attachHold({
        id: row.id,
        epoch,
        dotyposReservationId: winnerId,
        reservationCreatedAt: winnerCreatedAt,
      });
      const attachedCandidate = getHoldCreationMarker(row);
      if (attachedCandidate?._tag !== "candidate") {
        return yield* Effect.die("Expected persisted candidate fence.");
      }
      const originalStabilizationDeadline =
        attachedCandidate.stabilizationDeadline;
      const loserConflict = yield* Effect.result(
        repository.recordProviderHoldCandidate({
          id: row.id,
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
        })
      );
      const claimed =
        yield* repository.claimDifferentProviderAttachmentRecovery({
          id: row.id,
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId,
          staleBefore: Temporal.Instant.from("2026-06-01T09:55:00Z"),
        });
      yield* repository.releaseDifferentProviderAttachmentRecovery({
        id: row.id,
        epoch,
        dotyposReservationId: loserId,
        reservationCreatedAt: loserCreatedAt,
        ownerId,
      });
      const reclaimed =
        yield* repository.claimDifferentProviderAttachmentRecovery({
          id: row.id,
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId: retryOwnerId,
          staleBefore: Temporal.Instant.from("2026-06-01T09:55:00Z"),
        });
      yield* repository.beginDifferentProviderAttachmentCancellationVerification(
        {
          id: row.id,
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId: retryOwnerId,
        }
      );
      yield* repository.releaseDifferentProviderAttachmentRecovery({
        id: row.id,
        epoch,
        dotyposReservationId: loserId,
        reservationCreatedAt: loserCreatedAt,
        ownerId: retryOwnerId,
      });
      const verificationReclaimed =
        yield* repository.claimDifferentProviderAttachmentRecovery({
          id: row.id,
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId: retryOwnerId,
          staleBefore: Temporal.Instant.from("2026-06-01T09:55:00Z"),
        });
      yield* repository.completeDifferentProviderAttachmentRecovery({
        id: row.id,
        epoch,
        dotyposReservationId: loserId,
        reservationCreatedAt: loserCreatedAt,
        ownerId: retryOwnerId,
      });
      return {
        loserConflict,
        claimed,
        reclaimed,
        verificationReclaimed,
        originalStabilizationDeadline,
      };
    }).pipe(
      Effect.provide(
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, {
              db: { update, select } as never,
            })
          )
        )
      )
    );

    const result = await Effect.runPromise(program);

    expect(result.loserConflict._tag).toBe("Failure");
    expect(result.claimed).toBe(true);
    expect(result.reclaimed).toBe(true);
    expect(result.verificationReclaimed).toBe(true);
    expect(row).toMatchObject({
      reservationState: "held",
      dotyposReservationId: winnerId,
    });
    const candidate = getHoldCreationMarker(row);
    expect(candidate).toMatchObject({
      _tag: "candidate",
      epoch,
      dotyposReservationId: winnerId,
    });
    expect(
      candidate?._tag === "candidate" && candidate.stabilizationDeadline
    ).toEqual(result.originalStabilizationDeadline);
    expect(row.reservationCreatedAt?.equals(winnerCreatedAt)).toBe(true);
  });

  test("bounds repeated insert conflicts whose session occupant disappears before relookup", async () => {
    let insertAttempts = 0;
    const db = {
      insert: () => ({
        values: () => ({
          onConflictDoNothing: () => ({
            returning: () =>
              Effect.sync(() => {
                insertAttempts += 1;
                return [];
              }),
          }),
        }),
      }),
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Effect.succeed([]),
            orderBy: () => ({
              limit: () => Effect.succeed([]),
            }),
          }),
        }),
      }),
    };
    const acquisition = await Effect.gen(function* () {
      const repository = yield* WorkspaceReservationRepository;
      return yield* repository.acquireDraft({
        checkoutSessionKey: "synthetic-disappearing-session",
        checkoutAttemptKey: "synthetic-disappearing-attempt",
        dotyposCustomerId: "synthetic-customer",
        customerAccessCode: "synthetic-code",
        reservationDetails: {
          kind: "cowork",
          date: "2026-06-01",
          entry: "basic",
        },
        locale: "en",
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationRepositoryLive.pipe(
          Layer.provide(
            Layer.succeed(WorkspaceDatabase, {
              db: db as never,
            })
          )
        )
      ),
      Effect.runPromise
    );

    expect(acquisition._tag).toBe("conflict_unresolved");
    expect(insertAttempts).toBe(3);
  }, 1000);

  test("keeps superseded rows immutable while replacing them atomically", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "completeSupersessionAndCreateDraft: Effect.fn(",
      "      markCancellationFailed: Effect.fn("
    );

    expect(section).toContain("db.transaction(");
    expect(section).toContain(".update(workspaceReservations)");
    expect(section).toContain(".insert(workspaceReservations)");
    expect(section.indexOf(".update(workspaceReservations)")).toBeLessThan(
      section.indexOf(".insert(workspaceReservations)")
    );
    expect(
      section.slice(
        section.indexOf(".update(workspaceReservations)"),
        section.indexOf(".insert(workspaceReservations)")
      )
    ).not.toContain("reservationDetails");
  });

  test("makes provider entry one-way and releases only after confirmed compensation", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      'claimHoldCreation: Effect.fn("workspaceReservations.claimHoldCreation")',
      'attachHold: Effect.fn("workspaceReservations.attachHold")'
    );

    expect(source).toContain("preProviderHoldCreationMarker");
    expect(source).toContain("providerHoldCreationReconciliationMarker");
    expect(section).toContain(
      "failureCode: preProviderHoldCreationMarker(epoch)"
    );
    expect(section).toContain("beginProviderHoldCreation");
    expect(section).toContain(
      "failureCode: providerHoldCreationReconciliationMarker(input.epoch)"
    );
    expect(section).toContain("reclaimPreProviderHoldCreation");
    expect(section).toContain("reclaimStalePreProviderHoldCreation");
    expect(section).toContain("providerHoldCreationRecoveryMarker");
    expect(section).toContain("providerHoldCreationCompensationMarker");
    expect(section).toContain("releaseHoldCreation");
    expect(section).toContain('reservationState: "draft"');
    expect(section).toContain("failureCode: null");
    expect(section).toContain("dotyposReservationId");
    expect(section).toContain("input.epoch");
    expect(section).toContain("isAlreadyReleased");
    expect(source).toContain("loadSameAttachedHold");
    expect(source).toContain("recordProviderHoldCandidate: Effect.fn(");
    expect(source).toContain("providerHoldCreationCandidateMarker(");
    expect(source).toContain(
      "providerHoldCreationCandidateCompensationMarker("
    );
    expect(source).toContain("reservationCreatedAt.epochMilliseconds");
    expect(source).toContain(
      "reservation.dotyposReservationId === dotyposReservationId"
    );
    expect(source).toContain('marker?._tag === "candidate"');
    expect(source).toContain("providerHoldCreationAttachedMarker(input.epoch)");
    expect(source).toContain(
      "providerHoldCreationCandidateCompensationMarker("
    );
    const handoff = sliceFrom(
      source,
      "markAttachFailedCancellationRequired: Effect.fn(",
      "recordDifferentProviderAttachmentRecovery: Effect.fn("
    );
    expect(handoff).toContain(
      "providerHoldCreationCandidateCompensationMarker("
    );
    expect(handoff).toContain('"cancellation_failed"');
    expect(handoff).toContain("input.reservationCreatedAt");
    expect(handoff).toContain("existing.dotyposReservationId");
    expect(source).toContain('"cancellation_claimed"');
    const conflictRecovery = sliceFrom(
      source,
      "recordDifferentProviderAttachmentRecovery: Effect.fn(",
      'claimCancellation: Effect.fn("workspaceReservations.claimCancellation")'
    );
    expect(conflictRecovery).toContain(
      "providerHoldCreationAttachedMarker(input.epoch)"
    );
    expect(conflictRecovery).toContain("getProviderHoldCandidateFence");
    expect(conflictRecovery).toContain(
      "providerHoldCreationOrphanRecoveryMarker"
    );
    expect(conflictRecovery).toContain(
      "completeDifferentProviderAttachmentRecovery"
    );
    expect(conflictRecovery).toContain(
      "claimDifferentProviderAttachmentRecovery"
    );
    expect(conflictRecovery).toContain(
      "releaseDifferentProviderAttachmentRecovery"
    );
    expect(conflictRecovery).toContain(
      "providerHoldCreationOrphanProcessingMarker"
    );
    expect(conflictRecovery).toContain(
      "providerHoldCreationAttachedMarker(input.epoch)"
    );
  });

  test("canonicalizes provider identities before draft and attachment persistence", async () => {
    const source = await readRepository();
    const acquisition = sliceFrom(
      source,
      'acquireDraft: Effect.fn("workspaceReservations.acquireDraft")',
      "      findById,"
    );
    const attachment = sliceFrom(
      source,
      'attachHold: Effect.fn("workspaceReservations.attachHold")',
      "      markAttachFailedCancellationRequired: Effect.fn("
    );

    expect(source).toContain("requireCanonicalProviderId");
    expect(acquisition).toContain("const dotyposCustomerId = yield*");
    expect(acquisition).toContain("dotyposCustomerId,");
    expect(attachment).toContain("const dotyposReservationId = yield*");
    expect(attachment).toContain("dotyposReservationId,");
    expect(attachment).not.toContain(
      "reservationHoldExpiresAt: input.reservationHoldExpiresAt"
    );
  });

  test("blocks cancellation and cleanup mutations while loser recovery is unresolved", async () => {
    const source = await readRepository();
    const cancellation = sliceFrom(
      source,
      'claimCancellation: Effect.fn("workspaceReservations.claimCancellation")',
      "      markCancelled: Effect.fn("
    );
    const skippedCleanup = sliceFrom(
      source,
      "recordHoldCleanupSkipped: Effect.fn(",
      'markPaymentPaid: Effect.fn("workspaceReservations.markPaymentPaid")'
    );

    expect(cancellation).toContain("hasNoUnresolvedProviderAttachmentRecovery");
    expect(skippedCleanup).toContain(
      "hasNoUnresolvedProviderAttachmentRecovery"
    );
  });

  test("keeps attachment non-payable until stale exact recovery finalizes it", async () => {
    const source = await readRepository();
    const attachment = sliceFrom(
      source,
      'attachHold: Effect.fn("workspaceReservations.attachHold")',
      "      markAttachFailedCancellationRequired: Effect.fn("
    );
    const recoverySelection = sliceFrom(
      source,
      "selectPendingProviderAttachmentRecoveries: Effect.fn(",
      "      selectCancellationCandidates: Effect.fn("
    );

    expect(attachment).toContain("failureCode: candidateMarker");
    expect(attachment).toContain("completeProviderHoldCandidate");
    expect(attachment).toContain(
      "failureCode: providerHoldCreationAttachedMarker(input.epoch)"
    );
    expect(attachment).toContain(
      'eq(workspaceReservations.paymentState, "not_started")'
    );
    expect(recoverySelection).toContain("hold_creation_candidate:%");
    expect(recoverySelection).toContain(
      "hold_creation_candidate_compensating:%"
    );
    expect(recoverySelection).toContain("hold_creation_orphan_recovery:%");
    expect(recoverySelection).toContain("hold_creation_orphan_processing:%");
    expect(recoverySelection).toContain(
      "hold_creation_orphan_awaiting_visibility:%"
    );
    expect(recoverySelection).toContain("hold_creation_orphan_verifying:%");
    expect(recoverySelection).toContain(
      "lte(workspaceReservations.updatedAt, input.staleBefore)"
    );
  });

  test("selects expired holds in a deterministic starvation-safe limited order", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "      selectCancellationCandidates: Effect.fn(",
      "      selectExpiredHoldDotyposReservationIds: Effect.fn("
    );

    expect(source).toContain("readonly limit: number");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain("workspaceReservations.paymentState");
    expect(section).toContain("<> 'paid'");
    expect(section).toContain(".orderBy(");
    expect(section).toContain("coalesce(");
    expect(section).toContain("workspaceReservations.reservationHoldExpiredAt");
    expect(section).toContain(
      "asc(workspaceReservations.reservationHoldExpiresAt)"
    );
    expect(section).toContain("asc(workspaceReservations.id)");
    expect(section.indexOf(".orderBy(")).toBeLessThan(
      section.indexOf(".limit(input.limit)")
    );
  });

  test("records skipped cleanup attempts without changing reservation state", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "recordHoldCleanupSkipped: Effect.fn(",
      'markPaymentPaid: Effect.fn("workspaceReservations.markPaymentPaid")'
    );

    expect(section).toContain("reservationHoldExpiredAt: input.holdExpiredAt");
    expect(section).toContain("failureCode: input.failureCode");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain("workspaceReservations.paymentState");
    expect(section).toContain("<> 'paid'");
    expect(section).not.toContain("reservationState:");
  });

  test("selects expired local Dotypos holds for availability filtering", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      "selectExpiredHoldDotyposReservationIds: Effect.fn(",
      "      }),\n    });"
    );

    expect(section).toContain("dotyposReservationId");
    expect(section).toContain(
      'eq(workspaceReservations.reservationState, "held")'
    );
    expect(section).toContain("inArray(workspaceReservations.paymentState");
    expect(section).toContain('"not_started"');
    expect(section).toContain('"failed"');
    expect(section).toContain('"cancelled"');
    expect(section).toContain('"expired"');
    expect(section).not.toContain('"pending"');
    expect(section).toContain("dotyposReservationId} is not null");
    expect(section).toContain(
      "lte(workspaceReservations.reservationHoldExpiresAt, input.now)"
    );
  });
});

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

describe("WorkspaceReservationRepository different-provider ownership", () => {
  test("enforces the exact owner and timestamp through the real verification CAS", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        const epoch = "synthetic-real-verification-epoch";
        const winnerId = "synthetic-real-verification-winner";
        const loserId = "synthetic-real-verification-loser";
        const loserCreatedAt = instant("2026-07-23T09:00:00Z");
        const wrongCreatedAt = loserCreatedAt.add({ milliseconds: 1 });
        const ownerId = "synthetic-real-verification-owner";
        const processingMarker = `hold_creation_orphan_processing:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${ownerId}`;
        yield* db.insert(workspaceReservations).values(
          reservationRow("real-verification-cas", {
            dotyposReservationId: winnerId,
            reservationCreatedAt: instant("2026-07-23T08:59:00Z"),
            failureCode: processingMarker,
          })
        );
        const beginInput = {
          id: "real-verification-cas",
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId,
        };

        expect(
          yield* Effect.flip(
            repository.beginDifferentProviderAttachmentCancellationVerification(
              {
                ...beginInput,
                ownerId: "synthetic-wrong-owner",
              }
            )
          )
        ).toBeInstanceOf(WorkspaceReservationStateError);
        expect(
          yield* Effect.flip(
            repository.beginDifferentProviderAttachmentCancellationVerification(
              {
                ...beginInput,
                reservationCreatedAt: wrongCreatedAt,
              }
            )
          )
        ).toBeInstanceOf(WorkspaceReservationStateError);
        const [beforeExactBegin] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, beginInput.id));
        expect(beforeExactBegin?.failureCode).toBe(processingMarker);

        yield* repository.beginDifferentProviderAttachmentCancellationVerification(
          beginInput
        );
        yield* repository.beginDifferentProviderAttachmentCancellationVerification(
          beginInput
        );
        const verifyingMarker = `hold_creation_orphan_verifying:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${ownerId}`;
        const [afterExactBegin] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, beginInput.id));
        expect(afterExactBegin?.failureCode).toBe(verifyingMarker);

        expect(
          yield* Effect.flip(
            repository.releaseDifferentProviderAttachmentRecovery({
              ...beginInput,
              ownerId: "synthetic-wrong-owner",
            })
          )
        ).toBeInstanceOf(WorkspaceReservationStateError);
        expect(
          yield* Effect.flip(
            repository.completeDifferentProviderAttachmentRecovery({
              ...beginInput,
              reservationCreatedAt: wrongCreatedAt,
            })
          )
        ).toBeInstanceOf(WorkspaceReservationStateError);
        const [afterRejectedMutations] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, beginInput.id));
        expect(afterRejectedMutations?.failureCode).toBe(verifyingMarker);
        expect(afterRejectedMutations?.dotyposReservationId).toBe(winnerId);
        expect(afterRejectedMutations?.paymentState).toBe("not_started");
      })
    );
  });

  test("takes over the real verifying CAS only at the inclusive stale boundary", async () => {
    await runRepositoryTest(
      Effect.gen(function* () {
        const { db } = yield* WorkspaceDatabase;
        const repository = yield* WorkspaceReservationRepository;
        const epoch = "synthetic-real-takeover-epoch";
        const winnerId = "synthetic-real-takeover-winner";
        const loserId = "synthetic-real-takeover-loser";
        const loserCreatedAt = instant("2026-07-23T09:00:00Z");
        const staleBoundary = instant("2026-07-23T10:00:00Z");
        const originalOwnerId = "synthetic-real-takeover-owner";
        const newOwnerId = "synthetic-real-takeover-new-owner";
        yield* db.insert(workspaceReservations).values(
          reservationRow("real-verification-takeover", {
            dotyposReservationId: winnerId,
            reservationCreatedAt: instant("2026-07-23T08:59:00Z"),
            failureCode: `hold_creation_orphan_verifying:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${originalOwnerId}`,
            updatedAt: staleBoundary,
          })
        );
        const claimInput = {
          id: "real-verification-takeover",
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId: newOwnerId,
        };

        expect(
          yield* repository.claimDifferentProviderAttachmentRecovery({
            ...claimInput,
            staleBefore: staleBoundary.subtract({ milliseconds: 1 }),
          })
        ).toBe(false);
        expect(
          yield* repository.claimDifferentProviderAttachmentRecovery({
            ...claimInput,
            staleBefore: staleBoundary,
          })
        ).toBe(true);

        const [stored] = yield* db
          .select()
          .from(workspaceReservations)
          .where(eq(workspaceReservations.id, claimInput.id));
        expect(
          stored && getDifferentProviderAttachmentRecovery(stored)
        ).toMatchObject({
          epoch,
          dotyposReservationId: loserId,
          reservationCreatedAt: loserCreatedAt,
          ownerId: newOwnerId,
          phase: "verifying",
        });
        expect(stored?.dotyposReservationId).toBe(winnerId);
        expect(stored?.paymentState).toBe("not_started");
      })
    );
  });
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
        expect(stored?.reservationState).toBe("cancellation_claimed");
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
        expect(stored?.reservationState).toBe("cancellation_claimed");
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
            reservationState: "cancellation_claimed",
            cancellationClaimOwner: "old-owner",
            cancellationClaimedAt: instant("2026-07-23T09:00:00Z"),
          }),
          reservationRow("boundary", {
            reservationState: "cancellation_claimed",
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
          reservationState: "cancellation_claimed",
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
            reservationState: "cancellation_claimed",
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
