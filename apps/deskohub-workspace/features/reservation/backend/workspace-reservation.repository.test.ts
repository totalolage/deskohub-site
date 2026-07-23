import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  getHoldCreationMarker,
  WorkspaceReservationRepository,
  WorkspaceReservationRepositoryLive,
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
              const canResolveLoser =
                failureCode?.startsWith(
                  `hold_creation_candidate:${epoch}:${winnerId}:`
                ) &&
                row.failureCode?.startsWith(
                  `hold_creation_orphan_processing:${epoch}:${loserId}:`
                ) === true;
              if (
                !canRecordCandidate &&
                !canAttach &&
                !canRecordLoser &&
                !canClaimLoser &&
                !canReleaseLoser &&
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
    expect(source).toContain(
      '["cancellation_failed", "cancelling", "cancelled"].includes'
    );
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
      'selectExpiredHolds: Effect.fn("workspaceReservations.selectExpiredHolds")'
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
      "lte(workspaceReservations.updatedAt, input.staleBefore)"
    );
  });

  test("selects expired holds in a deterministic starvation-safe limited order", async () => {
    const source = await readRepository();
    const section = sliceFrom(
      source,
      'selectExpiredHolds: Effect.fn("workspaceReservations.selectExpiredHolds")',
      "        (effect, input) => effect.pipe(Effect.annotateLogs(input))"
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
