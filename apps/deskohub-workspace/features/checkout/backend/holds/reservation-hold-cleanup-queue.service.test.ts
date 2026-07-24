import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  DotyposService,
  ExternalAPIError,
  NetworkError,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import type { WorkspaceReservation } from "@/db/schema";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "./reservation-hold-cleanup.service";

mock.module("server-only", () => ({}));
const { ReservationHoldCleanupService } = await import(
  "./reservation-hold-cleanup.service"
);

const now = Temporal.Instant.from("2026-06-01T10:00:00.000Z");
const expiresAt = Temporal.Instant.from("2026-06-01T10:10:00.000Z");
const dueNow = Temporal.Instant.from("2026-06-01T10:10:00.000Z");

const makeReservation = (
  overrides: Partial<WorkspaceReservation> = {}
): WorkspaceReservation =>
  ({
    id: "order-id",
    checkoutSessionKey: "session-key",
    checkoutAttemptKey: "attempt-key",
    correlationId: "correlation-id",
    dotyposCustomerId: "customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    customerAccessCode: "",
    reservationState: "held",
    paymentState: "not_started",
    fulfillmentState: "not_started",
    activePaymentAttemptId: null,
    productTier: "basic",
    productCoffee: false,
    productMonitorOption: null,
    locale: "en-US",
    reservationHoldExpiresAt: expiresAt,
    reservationHoldExpiredAt: null,
    reservationCreatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    reservationConfirmedAt: null,
    reservationCancelledAt: null,
    cancellationClaimOwner: null,
    cancellationClaimedAt: null,
    paidAt: null,
    fulfilledAt: null,
    fulfillmentFailedAt: null,
    failureCode: null,
    fulfillmentFailureCode: null,
    createdAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    updatedAt: Temporal.Instant.from("2026-06-01T09:55:00.000Z"),
    ...overrides,
  }) as WorkspaceReservation;

const runProcessMessage = async (
  message: unknown,
  input: {
    readonly findById?: ReturnType<typeof mock>;
    readonly recordAttachmentCancellationHandoff?: ReturnType<typeof mock>;
    readonly cancelOrderHold?: ReturnType<typeof mock>;
    readonly now?: Temporal.Instant;
  } = {}
) => {
  const { ReservationHoldCleanupService } = await import(
    "./reservation-hold-cleanup.service"
  );
  const { processReservationHoldCleanupScheduleMessage } = await import(
    "./reservation-hold-cleanup-queue.service"
  );
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const findById =
    input.findById ?? mock(() => Effect.succeed(makeReservation()));
  const cancelOrderHold =
    input.cancelOrderHold ?? mock(() => Effect.succeed("cancelled" as const));
  const recordAttachmentCancellationHandoff =
    input.recordAttachmentCancellationHandoff ??
    mock(() => Effect.succeed(makeReservation()));

  const result = await processReservationHoldCleanupScheduleMessage(
    message,
    input.now ?? now
  ).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(WorkspaceReservationRepository, {
          findById,
          recordAttachmentCancellationHandoff,
        } as unknown as WorkspaceReservationRepositoryType),
        Layer.succeed(ReservationHoldCleanupService, {
          cancelOrderHold,
          sweepExpiredHolds: mock(() =>
            Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
          ),
        } satisfies ReservationHoldCleanupServiceType)
      )
    ),
    Effect.runPromise
  );

  return {
    result,
    findById,
    recordAttachmentCancellationHandoff,
    cancelOrderHold,
  };
};

const duePayload = {
  schemaVersion: 2,
  reason: "hold_expired",
  orderId: "order-id",
  reservationHoldExpiresAtIso: expiresAt.toString(),
};

const attachmentPayload = {
  schemaVersion: 2,
  reason: "attachment_compensation",
  orderId: "order-id",
  dotyposReservationId: "provider-reservation-id",
  reservationCreatedAtIso: now.toString(),
};

const makeProviderEvidence = (input: {
  readonly id: string;
  readonly status: "NEW" | "CANCELLED" | "CONFIRMED";
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
    status: input.status,
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
        "NEW",
        note,
      ])
    )
    .digest("base64url");
  return {
    ...provider,
    note: `${note}\nProvider request evidence: ${evidence}`,
  };
};

const makeDefinitiveWinnerAndLoserEvidence = (input: {
  readonly reservation: WorkspaceReservation;
  readonly epoch: string;
  readonly winnerId: string;
  readonly loserId: string;
  readonly loserStatus: "NEW" | "CANCELLED";
}) => [
  makeProviderEvidence({
    id: input.winnerId,
    status: "NEW",
    orderId: input.reservation.id,
    epoch: input.epoch,
    customerId: input.reservation.dotyposCustomerId,
  }),
  makeProviderEvidence({
    id: input.loserId,
    status: input.loserStatus,
    orderId: input.reservation.id,
    epoch: input.epoch,
    customerId: input.reservation.dotyposCustomerId,
  }),
];

const runAttachmentRedeliveryScenario = async (input: {
  readonly recoveryKind: "unattached" | "attachment_unknown";
  readonly firstExit:
    | "typed_failure"
    | "defect"
    | "interruption"
    | "success"
    | "commit_then_error";
}) => {
  const {
    getAttachmentCancellationScheduleMessage,
    processReservationHoldCleanupScheduleMessage,
  } = await import("./reservation-hold-cleanup-queue.service");
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const epoch = `synthetic-${input.recoveryKind}-${input.firstExit}-epoch`;
  const providerId = `synthetic-${input.recoveryKind}-${input.firstExit}-provider`;
  const exactFailureCode = `attach_failed_cancel_failed:${epoch}`;
  let row = makeReservation({
    dotyposReservationId: null,
    reservationState: "creating_hold",
    reservationCreatedAt: now,
    failureCode: `hold_creation_compensating:${epoch}`,
  });
  let cancellationAttempts = 0;
  const markAttachFailedCancellationRequired = mock((markerInput) =>
    Effect.sync(() => {
      const sameProvider =
        row.dotyposReservationId === null ||
        row.dotyposReservationId === markerInput.dotyposReservationId;
      const sameCreatedAt =
        row.reservationCreatedAt?.equals(markerInput.reservationCreatedAt) ??
        false;
      if (
        !sameProvider ||
        !sameCreatedAt ||
        (row.reservationState !== "creating_hold" &&
          row.reservationState !== "cancellation_failed")
      ) {
        throw new Error("Synthetic exact attachment recovery CAS rejected");
      }
      row = makeReservation({
        ...row,
        dotyposReservationId: markerInput.dotyposReservationId,
        reservationState: "cancellation_failed",
        reservationCreatedAt: markerInput.reservationCreatedAt,
        failureCode: exactFailureCode,
      });
    })
  );
  const cancelOrderHold = mock(() =>
    Effect.suspend(() => {
      cancellationAttempts += 1;
      if (cancellationAttempts > 1) {
        row = makeReservation({
          ...row,
          reservationState: "cancelled",
          failureCode: exactFailureCode,
        });
        return Effect.succeed("cancelled" as const);
      }
      if (input.firstExit === "typed_failure") {
        row = makeReservation({
          ...row,
          reservationState: "cancellation_failed",
          failureCode: "synthetic_s5_cancellation_failure",
        });
        return Effect.fail(new Error("Synthetic typed cancellation failure"));
      }
      if (input.firstExit === "defect") {
        row = makeReservation({
          ...row,
          reservationState: "cancelling",
          failureCode: exactFailureCode,
        });
        return Effect.die(new Error("Synthetic cancellation defect"));
      }
      if (input.firstExit === "interruption") {
        row = makeReservation({
          ...row,
          reservationState: "cancelling",
          failureCode: exactFailureCode,
        });
        return Effect.never;
      }
      row = makeReservation({
        ...row,
        reservationState: "cancelled",
        failureCode: exactFailureCode,
      });
      return input.firstExit === "commit_then_error"
        ? Effect.fail(new Error("Synthetic cancellation acknowledgement loss"))
        : Effect.succeed("cancelled" as const);
    })
  );
  const payload = getAttachmentCancellationScheduleMessage({
    recoveryKind: input.recoveryKind,
    orderId: row.id,
    providerCreationEpoch: epoch,
    dotyposReservationId: providerId,
    reservationCreatedAt: now,
  }).payload;
  const layer = Layer.mergeAll(
    Layer.succeed(WorkspaceReservationRepository, {
      findById: mock(() => Effect.sync(() => row)),
      claimHoldCreationCompensation: mock(() => Effect.succeed(true)),
      markAttachFailedCancellationRequired,
      recordDifferentProviderAttachmentRecovery: mock(() =>
        Effect.fail(new Error("Must classify exact unattached recovery"))
      ),
    } as unknown as WorkspaceReservationRepositoryType),
    Layer.succeed(ReservationHoldCleanupService, {
      cancelOrderHold,
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
      ),
    } satisfies ReservationHoldCleanupServiceType),
    Layer.succeed(DotyposService, {} as never)
  );
  const first = processReservationHoldCleanupScheduleMessage(payload, now).pipe(
    Effect.provide(layer),
    ...(input.firstExit === "interruption" ? [Effect.timeout("10 millis")] : [])
  );

  if (input.firstExit === "success") {
    expect(await Effect.runPromise(first)).toBe("cancelled");
  } else {
    await expect(Effect.runPromise(first)).rejects.toBeDefined();
  }

  const retry = await processReservationHoldCleanupScheduleMessage(
    payload,
    now
  ).pipe(Effect.provide(layer), Effect.runPromise);
  return {
    retry,
    row,
    cancellationAttempts,
    markAttachFailedCancellationRequired,
  };
};

const runDifferentProviderCancellationBoundaryScenario = async (input: {
  readonly exitKind:
    | "typed_failure"
    | "defect"
    | "interruption"
    | "ambiguous_transport";
  readonly retainOwnedVerification: boolean;
}) => {
  const {
    getAttachmentCancellationScheduleMessage,
    processReservationHoldCleanupScheduleMessage,
  } = await import("./reservation-hold-cleanup-queue.service");
  const {
    getDifferentProviderAttachmentRecovery,
    WorkspaceReservationRepository,
  } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const epoch = `synthetic-${input.exitKind}-boundary-epoch`;
  const winnerId = `synthetic-${input.exitKind}-boundary-winner`;
  const loserId = `synthetic-${input.exitKind}-boundary-loser`;
  const loserCreatedAt = now;
  let deliveryNow = now;
  let loserStatus: "NEW" | "CANCELLED" = "NEW";
  let row = makeReservation({
    dotyposReservationId: winnerId,
    reservationCreatedAt: loserCreatedAt,
    updatedAt: deliveryNow,
    failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}`,
  });
  let firstOwnerId: string | undefined;
  let completedOwnerId: string | undefined;
  const claim = mock((claimInput) =>
    Effect.sync(() => {
      const recovery = getDifferentProviderAttachmentRecovery(row);
      if (!recovery) return false;
      const ownedByAnother =
        (recovery.phase === "processing" || recovery.phase === "verifying") &&
        recovery.ownerId !== claimInput.ownerId;
      if (
        ownedByAnother &&
        Temporal.Instant.compare(row.updatedAt, claimInput.staleBefore) > 0
      ) {
        return false;
      }
      const verificationOnly =
        recovery.phase === "awaiting_visibility" ||
        recovery.phase === "verifying";
      row = makeReservation({
        ...row,
        updatedAt: deliveryNow,
        failureCode: verificationOnly
          ? `hold_creation_orphan_verifying:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${claimInput.ownerId}`
          : `hold_creation_orphan_processing:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${claimInput.ownerId}`,
      });
      return true;
    })
  );
  const beginVerification = mock((beginInput) =>
    Effect.sync(() => {
      firstOwnerId ??= beginInput.ownerId;
      row = makeReservation({
        ...row,
        updatedAt: deliveryNow,
        failureCode: `hold_creation_orphan_verifying:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${beginInput.ownerId}`,
      });
    })
  );
  const release = mock((releaseInput) =>
    input.retainOwnedVerification
      ? Effect.fail(new Error("Synthetic verification release failure"))
      : Effect.sync(() => {
          row = makeReservation({
            ...row,
            updatedAt: deliveryNow,
            failureCode: `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}`,
          });
          expect(releaseInput.ownerId).toBe(firstOwnerId);
        })
  );
  const complete = mock((completeInput) =>
    Effect.sync(() => {
      completedOwnerId = completeInput.ownerId;
      row = makeReservation({
        ...row,
        failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}`,
      });
    })
  );
  const listReservations = mock(() =>
    Effect.succeed(
      makeDefinitiveWinnerAndLoserEvidence({
        reservation: row,
        epoch,
        winnerId,
        loserId,
        loserStatus,
      })
    )
  );
  const cancelReservation = mock(() =>
    Effect.suspend(() => {
      if (input.exitKind === "typed_failure") {
        return Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation: "cancelReservation",
            statusCode: 503,
            message: "Synthetic provider cancellation failure",
          })
        );
      }
      if (input.exitKind === "defect") {
        return Effect.die(new Error("Synthetic provider cancellation defect"));
      }
      if (input.exitKind === "interruption") return Effect.never;
      loserStatus = "CANCELLED";
      return Effect.fail(
        new NetworkError({
          message: "Synthetic cancellation response was lost",
        })
      );
    })
  );
  const payload = getAttachmentCancellationScheduleMessage({
    recoveryKind: "different_provider",
    orderId: row.id,
    providerCreationEpoch: epoch,
    dotyposReservationId: loserId,
    reservationCreatedAt: loserCreatedAt,
  }).payload;
  const layer = Layer.mergeAll(
    Layer.succeed(WorkspaceReservationRepository, {
      findById: mock(() => Effect.sync(() => row)),
      recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
      claimDifferentProviderAttachmentRecovery: claim,
      beginDifferentProviderAttachmentCancellationVerification:
        beginVerification,
      releaseDifferentProviderAttachmentRecovery: release,
      completeDifferentProviderAttachmentRecovery: complete,
    } as unknown as WorkspaceReservationRepositoryType),
    Layer.succeed(ReservationHoldCleanupService, {
      cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
      sweepExpiredHolds: mock(() =>
        Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
      ),
    } satisfies ReservationHoldCleanupServiceType),
    Layer.succeed(DotyposService, {
      listReservations,
      cancelReservation,
    } as unknown as typeof DotyposService.Service)
  );
  const process = (processNow: Temporal.Instant) =>
    processReservationHoldCleanupScheduleMessage(payload, processNow).pipe(
      Effect.provide(layer)
    );
  const first = process(now).pipe(
    ...(input.exitKind === "interruption" ? [Effect.timeout("10 millis")] : [])
  );
  await expect(Effect.runPromise(first)).rejects.toBeDefined();

  const boundaryRecovery = getDifferentProviderAttachmentRecovery(row);
  expect(cancelReservation).toHaveBeenCalledTimes(1);
  expect(beginVerification).toHaveBeenCalledTimes(1);
  expect(complete).not.toHaveBeenCalled();
  expect(boundaryRecovery).toMatchObject({
    epoch,
    dotyposReservationId: loserId,
    reservationCreatedAt: loserCreatedAt,
    phase: input.retainOwnedVerification ? "verifying" : "awaiting_visibility",
  });
  expect(firstOwnerId).toBeDefined();

  loserStatus = "CANCELLED";
  if (input.retainOwnedVerification) {
    const lookupsBeforeLiveOwnerRetry = listReservations.mock.calls.length;
    await expect(Effect.runPromise(process(now))).rejects.toBeDefined();
    expect(listReservations).toHaveBeenCalledTimes(lookupsBeforeLiveOwnerRetry);
    expect(cancelReservation).toHaveBeenCalledTimes(1);
    deliveryNow = now.add({ minutes: 3 });
  }
  const redelivery = await Effect.runPromise(process(deliveryNow));
  const resolvedRecovery = row.failureCode;
  return {
    beginVerification,
    cancelReservation,
    complete,
    completedOwnerId,
    firstOwnerId,
    listReservations,
    redelivery,
    resolvedRecovery,
  };
};

describe("ReservationHoldCleanupScheduleService", () => {
  test("durably hands attachment identity to both marker and queue", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(makeReservation())
    );
    const enqueueCleanup = mock(() => Effect.void);

    await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );

    expect(recordAttachmentCancellationHandoff).toHaveBeenCalledWith({
      id: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
      failureCode: "attach_failed_cancellation_required",
    });
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    });
  });

  test("enqueues the exact attachment identity when the marker write fails", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const enqueueCleanup = mock(() => Effect.void);

    await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff: mock(() =>
              Effect.fail(new Error("marker unavailable"))
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );

    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    });
  });

  test("retains the database marker when attachment enqueue fails", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(makeReservation())
    );

    await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup: mock(() =>
              Effect.fail(new Error("queue unavailable"))
            ),
          })
        )
      ),
      Effect.runPromise
    );

    expect(recordAttachmentCancellationHandoff).toHaveBeenCalledTimes(1);
  });

  test("fails loudly when neither durable attachment handoff succeeds", async () => {
    const {
      AttachmentCancellationHandoffError,
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );

    const error = await enqueueAttachmentCancellationCompensation({
      orderId: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            recordAttachmentCancellationHandoff: mock(() =>
              Effect.fail(new Error("marker unavailable"))
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup: mock(() =>
              Effect.fail(new Error("queue unavailable"))
            ),
          })
        )
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(error).toBeInstanceOf(AttachmentCancellationHandoffError);
  });

  test("materializes an identity-bearing attachment message before cancellation", async () => {
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(
        makeReservation({
          reservationState: "cancellation_failed",
          cancellationRecoveryReason: "attachment_compensation",
        })
      )
    );
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));

    const result = await runProcessMessage(attachmentPayload, {
      recordAttachmentCancellationHandoff,
      cancelOrderHold,
    });

    expect(result.result).toBe("cancelled");
    expect(recordAttachmentCancellationHandoff).toHaveBeenCalledWith({
      id: "order-id",
      dotyposReservationId: "provider-reservation-id",
      reservationCreatedAt: now,
      failureCode: "attach_failed_cancellation_required",
    });
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "attachment_compensation",
    });
    expect(result.findById).not.toHaveBeenCalled();
  });

  test("duplicate attachment delivery and later state changes never reassign ownership", async () => {
    let delivery = 0;
    const recordAttachmentCancellationHandoff = mock(() =>
      Effect.succeed(
        delivery++ === 0
          ? makeReservation({
              reservationState: "cancellation_failed",
              cancellationRecoveryReason: "attachment_compensation",
            })
          : null
      )
    );
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));

    const first = await runProcessMessage(attachmentPayload, {
      recordAttachmentCancellationHandoff,
      cancelOrderHold,
    });
    const duplicate = await runProcessMessage(attachmentPayload, {
      recordAttachmentCancellationHandoff,
      cancelOrderHold,
    });

    expect(first.result).toBe("cancelled");
    expect(duplicate.result).toBe("ignored");
    expect(cancelOrderHold).toHaveBeenCalledTimes(1);
  });

  test("builds bounded delayed queue messages with idempotency", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      getReservationHoldCleanupScheduleMessage,
      reservationHoldCleanupScheduleMaxDelaySeconds,
      reservationHoldCleanupQueueTopic,
    } = await import("./reservation-hold-cleanup-queue.service");

    const message = getReservationHoldCleanupScheduleMessage(
      { orderId: "order-id", reservationHoldExpiresAt: expiresAt },
      now
    );
    expect(message).toEqual({
      topic: reservationHoldCleanupQueueTopic,
      payload: duePayload,
      options: {
        delaySeconds: 600,
        retentionSeconds: 4200,
        idempotencyKey: `reservation-hold-cleanup:order-id:${expiresAt.toString()}`,
      },
    });
    expect(
      getAttachmentCancellationScheduleMessage({
        orderId: "order-id",
        dotyposReservationId: "provider-reservation-id",
        reservationCreatedAt: now,
      })
    ).toEqual({
      topic: reservationHoldCleanupQueueTopic,
      payload: attachmentPayload,
      options: {
        delaySeconds: 0,
        retentionSeconds: 604_800,
        idempotencyKey:
          "reservation-attachment-cancellation:order-id:provider-reservation-id",
      },
    });

    const clamped = getReservationHoldCleanupScheduleMessage(
      {
        orderId: "order-id",
        reservationHoldExpiresAt: Temporal.Instant.from(
          "2026-06-09T10:00:01.000Z"
        ),
      },
      now
    );
    expect(clamped.options.delaySeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
    expect(clamped.options.retentionSeconds).toBe(
      reservationHoldCleanupScheduleMaxDelaySeconds
    );
  });

  test("treats duplicate queue messages as already enqueued", async () => {
    const source = await Bun.file(
      new URL("./reservation-hold-cleanup-queue.service.ts", import.meta.url)
    ).text();

    expect(source).toContain("DuplicateMessageError");
    expect(source).toContain("cause instanceof DuplicateMessageError");
    expect(source).toContain('Effect.succeed("duplicate" as const)');
  });

  test("keeps enqueue failure causes visible in structured logs", async () => {
    const { makeReservationHoldCleanupScheduleService } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const source = new Error("queue unavailable");
    const service = makeReservationHoldCleanupScheduleService(
      mock(() => Promise.reject(source)) as never
    );
    const error = await service
      .enqueueCleanup({
        reason: "hold_expired",
        orderId: "order-id",
        reservationHoldExpiresAt: expiresAt,
      })
      .pipe(Effect.flip, Effect.runPromise);

    expect(error.message).toBe(
      "Reservation hold cleanup could not be enqueued."
    );
    expect(error.cause).toMatchObject({
      name: "Error",
      message: "queue unavailable",
    });
    expect(error.cause).not.toBe(source);
  });

  test("retries an exact attachment-compensation enqueue with stable identity", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      makeReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    let attempt = 0;
    const sendMessage = mock(() => {
      attempt += 1;
      return attempt === 1
        ? Promise.reject(new Error("synthetic queue outage"))
        : Promise.resolve();
    });
    const service = makeReservationHoldCleanupScheduleService(
      sendMessage as never
    );
    const input = {
      reason: "attachment_compensation" as const,
      recoveryKind: "different_provider" as const,
      orderId: "synthetic-order",
      providerCreationEpoch: "synthetic-epoch",
      dotyposReservationId: "synthetic-loser",
      reservationCreatedAt: now,
    };

    await expect(
      service.enqueueCleanup(input).pipe(Effect.runPromise)
    ).rejects.toBeDefined();
    await service.enqueueCleanup(input).pipe(Effect.runPromise);

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(getAttachmentCancellationScheduleMessage(input).options).toEqual(
      expect.objectContaining({
        delaySeconds: 0,
        idempotencyKey:
          "reservation-attachment-cancellation:synthetic-order:synthetic-epoch:synthetic-loser",
      })
    );
  });

  test("keeps candidate stabilization distinct from immediate ambiguity delivery", async () => {
    const { getAttachmentCancellationScheduleMessage } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const input = {
      recoveryKind: "attachment_unknown" as const,
      orderId: "synthetic-stabilization-order",
      providerCreationEpoch: "synthetic-stabilization-epoch",
      dotyposReservationId: "synthetic-stabilization-provider",
      reservationCreatedAt: now,
    };
    const immediate = getAttachmentCancellationScheduleMessage(input);
    const stabilization = getAttachmentCancellationScheduleMessage({
      ...input,
      delaySeconds: 120,
      stabilizeCandidate: true,
    });

    expect(stabilization.options.delaySeconds).toBe(120);
    expect(stabilization.options.idempotencyKey).not.toBe(
      immediate.options.idempotencyKey
    );
  });

  test("keeps commit-ambiguous candidate delivery blocked until the persisted stabilization deadline", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-commit-ambiguity-epoch";
    const providerId = "synthetic-commit-ambiguity-provider";
    const createdAt = now.subtract({ minutes: 1 });
    let row = makeReservation({
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate:${epoch}:${providerId}:${createdAt.epochMilliseconds}`,
      updatedAt: now,
    });
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_attached:${epoch}`,
        });
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        completeProviderHoldCandidate: complete,
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupScheduleService, {
        enqueueCleanup: mock(() => Effect.void),
      }),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel candidate")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: providerId,
              status: "NEW",
              orderId: row.id,
              epoch,
              customerId: row.dotyposCustomerId,
            }),
          ])
        ),
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(complete).not.toHaveBeenCalled();
    expect(row.failureCode).toStartWith("hold_creation_candidate:");

    const retry = await processReservationHoldCleanupScheduleMessage(
      payload,
      now.add({ minutes: 2 })
    ).pipe(Effect.provide(layer), Effect.runPromise);
    expect(retry).toBe("cancelled");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBe(`hold_creation_attached:${epoch}`);
  });

  test("keeps an ambiguous queue handoff actionable when its marker write fails", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-queue-only-epoch";
    const providerId = "synthetic-queue-only-provider";
    let row = makeReservation({
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const recordCandidate = mock(() =>
      Effect.fail(new Error("synthetic marker write failure"))
    );
    const recordDifferent = mock(() =>
      Effect.die(
        "attachment_unknown must first retain exact candidate evidence"
      )
    );
    const queued: Parameters<
      ReservationHoldCleanupScheduleServiceType["enqueueCleanup"]
    >[0][] = [];
    const enqueueCleanup = mock((input) =>
      Effect.sync(() => {
        queued.push(input);
      })
    );

    await enqueueAttachmentCancellationCompensation({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: now,
    }).pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(WorkspaceReservationRepository, {
            recordProviderHoldCandidate: recordCandidate,
            recordDifferentProviderAttachmentRecovery: recordDifferent,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );

    expect(recordCandidate).toHaveBeenCalledTimes(1);
    expect(recordDifferent).not.toHaveBeenCalled();
    expect(enqueueCleanup).toHaveBeenCalledTimes(1);

    const queuedInput = queued[0];
    if (!queuedInput || queuedInput.reason !== "attachment_compensation") {
      throw new Error("Expected exact attachment recovery queue input.");
    }
    const payload =
      getAttachmentCancellationScheduleMessage(queuedInput).payload;
    let cancellationAttempts = 0;
    const cancelOrderHold = mock(() =>
      Effect.sync(() => {
        cancellationAttempts += 1;
        expect(row).toMatchObject({
          reservationState: "cancellation_failed",
          failureCode: `attach_failed_cancel_failed:${epoch}`,
          dotyposReservationId: providerId,
        });
        expect(row.reservationCreatedAt?.equals(now)).toBe(true);
        row = makeReservation({
          ...row,
          reservationState: "cancelled",
        });
        return "cancelled" as const;
      })
    );
    const cancelReservation = mock(() =>
      Effect.die("exact local ownership must not use broad cancellation")
    );
    const createReservation = mock(() =>
      Effect.die("queue-only recovery must not create a provider reservation")
    );
    const recoveryLayer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        claimHoldCreationCompensation: mock(() =>
          Effect.sync(() => {
            expect(row.failureCode).toBe(
              `hold_creation_provider_reconciliation:${epoch}`
            );
            row = makeReservation({
              ...row,
              failureCode: `hold_creation_compensating:${epoch}`,
            });
            return true;
          })
        ),
        markAttachFailedCancellationRequired: mock((input) =>
          Effect.sync(() => {
            expect(row.failureCode).toBe(`hold_creation_compensating:${epoch}`);
            row = makeReservation({
              ...row,
              dotyposReservationId: input.dotyposReservationId,
              reservationCreatedAt: input.reservationCreatedAt,
              reservationState: "cancellation_failed",
              failureCode: `attach_failed_cancel_failed:${input.epoch}`,
            });
          })
        ),
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold,
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        cancelReservation,
        createReservation,
      } as unknown as typeof DotyposService.Service)
    );
    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(recoveryLayer), Effect.runPromise);
    const redelivery = await processReservationHoldCleanupScheduleMessage(
      payload,
      now.add({ minutes: 1 })
    ).pipe(Effect.provide(recoveryLayer), Effect.runPromise);

    expect(result).toBe("cancelled");
    expect(redelivery).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: row.id,
      recoveryReason: "attachment_compensation",
    });
    expect(cancellationAttempts).toBe(1);
    expect(row).toMatchObject({
      reservationState: "cancelled",
      failureCode: `attach_failed_cancel_failed:${epoch}`,
      dotyposReservationId: providerId,
    });
    expect(row.reservationCreatedAt?.equals(now)).toBe(true);
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("attempts marker and queue handoff independently across defects", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const scenarios = [
      {
        marker: mock(() => Effect.die("synthetic marker defect")),
        enqueue: mock(() => Effect.void),
      },
      {
        marker: mock(() => Effect.void),
        enqueue: mock(() => Effect.die("synthetic enqueue defect")),
      },
    ];

    for (const scenario of scenarios) {
      await enqueueAttachmentCancellationCompensation({
        recoveryKind: "attachment_unknown",
        orderId: "synthetic-order",
        providerCreationEpoch: "synthetic-epoch",
        dotyposReservationId: "synthetic-loser",
        reservationCreatedAt: now,
      }).pipe(
        Effect.provide(
          Layer.merge(
            Layer.succeed(WorkspaceReservationRepository, {
              recordProviderHoldCandidate: scenario.marker,
            } as unknown as WorkspaceReservationRepositoryType),
            Layer.succeed(ReservationHoldCleanupScheduleService, {
              enqueueCleanup: scenario.enqueue,
            })
          )
        ),
        Effect.runPromise
      );
      expect(scenario.marker).toHaveBeenCalledTimes(1);
      expect(scenario.enqueue).toHaveBeenCalledTimes(1);
    }
  });

  test("classifies an ambiguous handoff as the already-attached same hold", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-unknown-same-epoch";
    const providerId = "synthetic-unknown-same-provider";
    const row = makeReservation({
      dotyposReservationId: providerId,
      failureCode: `hold_creation_attached:${epoch}`,
    });
    const enqueueCleanup = mock(() => Effect.void);
    const cancelReservation = mock(() =>
      Effect.die("same attached provider must not be cancelled")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: row.reservationCreatedAt ?? now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.succeed(row)),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          }),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            cancelReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "hold_expired",
      orderId: row.id,
      reservationHoldExpiresAt: row.reservationHoldExpiresAt,
    });
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("classifies an ambiguous handoff as a different-provider loser", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-unknown-different-epoch";
    const winnerId = "synthetic-unknown-different-winner";
    const loserId = "synthetic-unknown-different-loser";
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_attached:${epoch}`,
    });
    const recordRecovery = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
        });
      })
    );
    let loserStatus: "NEW" | "CANCELLED" = "NEW";
    const cancelReservation = mock(() =>
      Effect.sync(() => {
        loserStatus = "CANCELLED";
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            recordDifferentProviderAttachmentRecovery: recordRecovery,
            claimDifferentProviderAttachmentRecovery: mock((input) =>
              Effect.sync(() => {
                row = makeReservation({
                  ...row,
                  failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
                });
                return true;
              })
            ),
            beginDifferentProviderAttachmentCancellationVerification: mock(
              () => Effect.void
            ),
            releaseDifferentProviderAttachmentRecovery: mock(() => Effect.void),
            completeDifferentProviderAttachmentRecovery: mock(() =>
              Effect.sync(() => {
                row = makeReservation({
                  ...row,
                  failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
                });
              })
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations: mock(() =>
              Effect.succeed(
                makeDefinitiveWinnerAndLoserEvidence({
                  reservation: row,
                  epoch,
                  winnerId,
                  loserId,
                  loserStatus,
                })
              )
            ),
            cancelReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(recordRecovery).toHaveBeenCalledTimes(1);
    expect(cancelReservation).toHaveBeenCalledWith(loserId);
    expect(row.dotyposReservationId).toBe(winnerId);
  });

  test("classifies an ambiguous handoff as an unattached provider result", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-unknown-unattached-epoch";
    const providerId = "synthetic-unknown-unattached-provider";
    let row = makeReservation({
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_provider_reconciliation:${epoch}`,
    });
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            claimHoldCreationCompensation: mock(() =>
              Effect.sync(() => {
                row = makeReservation({
                  ...row,
                  failureCode: `hold_creation_compensating:${epoch}`,
                });
                return true;
              })
            ),
            markAttachFailedCancellationRequired: mock((input) =>
              Effect.sync(() => {
                row = makeReservation({
                  ...row,
                  dotyposReservationId: input.dotyposReservationId,
                  reservationState: "cancellation_failed",
                  failureCode: `attach_failed_cancel_failed:${input.epoch}`,
                });
              })
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold,
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {} as never)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: row.id,
      recoveryReason: "attachment_compensation",
    });
    expect(row).toMatchObject({
      dotyposReservationId: providerId,
      reservationState: "cancellation_failed",
      failureCode: `attach_failed_cancel_failed:${epoch}`,
    });
  });

  test("owns and cancels only the exact different-provider loser while preserving the winner", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-orphan-epoch";
    const winnerId = "synthetic-winner";
    const loserId = "synthetic-loser";
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    let ownerId: string | undefined;
    const claim = mock((input) =>
      Effect.sync(() => {
        if (input.epoch !== epoch || input.dotyposReservationId !== loserId) {
          return false;
        }
        ownerId = input.ownerId;
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
        });
        return true;
      })
    );
    const complete = mock((input) =>
      Effect.sync(() => {
        expect(input.ownerId).toBe(ownerId);
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
        });
      })
    );
    let evidenceLookup = 0;
    const cancelReservation = mock(() => Effect.void);
    const listReservations = mock(() => {
      evidenceLookup += 1;
      return Effect.succeed([
        makeProviderEvidence({
          id: winnerId,
          status: "NEW",
          orderId: row.id,
          epoch,
          customerId: row.dotyposCustomerId,
        }),
        makeProviderEvidence({
          id: loserId,
          status: evidenceLookup === 1 ? "NEW" : "CANCELLED",
          orderId: row.id,
          epoch,
          customerId: row.dotyposCustomerId,
        }),
      ]);
    });
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
            claimDifferentProviderAttachmentRecovery: claim,
            beginDifferentProviderAttachmentCancellationVerification: mock(
              () => Effect.void
            ),
            releaseDifferentProviderAttachmentRecovery: mock(() => Effect.void),
            completeDifferentProviderAttachmentRecovery: complete,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations,
            cancelReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(cancelReservation).toHaveBeenCalledWith(loserId);
    expect(row.dotyposReservationId).toBe(winnerId);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}`
    );
    expect(claim).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(listReservations).toHaveBeenCalledTimes(2);
  });

  test.each([
    ["missing winner", ["loser_cancelled"]],
    ["unsafe winner", ["winner_unsafe", "loser_cancelled"]],
    ["third live result", ["winner_live", "loser_cancelled", "third_live"]],
  ] as const)("keeps payment recovery fenced when post-compensation evidence has %s", async (_reason, evidenceKinds) => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-post-compensation-epoch";
    const winnerId = "synthetic-post-compensation-winner";
    const loserId = "synthetic-post-compensation-loser";
    const loserCreatedAt = Temporal.Instant.from("2026-06-01T10:00:00Z");
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}`,
    });
    const complete = mock(() => Effect.void);
    const beginVerification = mock((input) =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_verifying:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${input.ownerId}`,
        });
      })
    );
    const claim = mock((input) =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}:${input.ownerId}`,
        });
        return true;
      })
    );
    const release = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}`,
        });
      })
    );
    const providerEvidence = evidenceKinds.map((kind) =>
      makeProviderEvidence({
        id:
          kind === "third_live"
            ? "synthetic-post-compensation-third"
            : kind === "loser_cancelled"
              ? loserId
              : winnerId,
        status:
          kind === "winner_unsafe"
            ? "CONFIRMED"
            : kind === "loser_cancelled"
              ? "CANCELLED"
              : "NEW",
        orderId: row.id,
        epoch,
        customerId: row.dotyposCustomerId,
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: loserCreatedAt,
    }).payload;
    const listReservations = mock(() => Effect.succeed(providerEvidence));
    const cancelReservation = mock(() =>
      Effect.die("definitive cancelled evidence must not recancel")
    );

    const error = await processReservationHoldCleanupScheduleMessage(
      payload,
      dueNow
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
            claimDifferentProviderAttachmentRecovery: claim,
            beginDifferentProviderAttachmentCancellationVerification:
              beginVerification,
            releaseDifferentProviderAttachmentRecovery: release,
            completeDifferentProviderAttachmentRecovery: complete,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() =>
              Effect.die("must not cancel the winner")
            ),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations,
            cancelReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(error.message).toBe(
      "Different-provider attachment recovery remains fenced pending definitive evidence."
    );
    expect(error.cause).toMatchObject({
      message: "Provider attachment evidence is not definitive.",
    });
    expect(beginVerification).toHaveBeenCalledTimes(1);
    expect(beginVerification).toHaveBeenCalledWith({
      id: row.id,
      epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: loserCreatedAt,
      ownerId: expect.any(String),
    });
    expect(listReservations).toHaveBeenCalledTimes(2);
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
    expect(row.failureCode).toBe(
      `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}`
    );
  });

  test("makes an unattached cancellation_failed handoff reachable by the queue", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-unattached-epoch";
    const providerId = "synthetic-unattached-provider";
    let row = makeReservation({
      dotyposReservationId: null,
      reservationState: "creating_hold",
      failureCode: `hold_creation_compensating:${epoch}`,
    });
    const marker = mock((input) =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          dotyposReservationId: input.dotyposReservationId,
          reservationState: "cancellation_failed",
          reservationCreatedAt: input.reservationCreatedAt,
          failureCode: `attach_failed_cancel_failed:${input.epoch}`,
        });
      })
    );
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "unattached",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            markAttachFailedCancellationRequired: marker,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold,
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {} as never)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(marker).toHaveBeenCalledTimes(1);
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: row.id,
      recoveryReason: "attachment_compensation",
    });
    expect(row).toMatchObject({
      reservationState: "cancellation_failed",
      dotyposReservationId: providerId,
      failureCode: `attach_failed_cancel_failed:${epoch}`,
    });
  });

  test.each([
    "unattached",
    "attachment_unknown",
  ] as const)("restores exact %s evidence after typed cancellation failure and converges", async (recoveryKind) => {
    const result = await runAttachmentRedeliveryScenario({
      recoveryKind,
      firstExit: "typed_failure",
    });

    expect(result.retry).toBe("cancelled");
    expect(result.cancellationAttempts).toBe(2);
    expect(result.row).toMatchObject({
      reservationState: "cancelled",
      dotyposReservationId: expect.stringContaining(recoveryKind),
      failureCode: expect.stringContaining("attach_failed_cancel_failed:"),
    });
  });

  test.each([
    { recoveryKind: "unattached" as const, firstExit: "defect" as const },
    {
      recoveryKind: "attachment_unknown" as const,
      firstExit: "defect" as const,
    },
    {
      recoveryKind: "unattached" as const,
      firstExit: "interruption" as const,
    },
    {
      recoveryKind: "attachment_unknown" as const,
      firstExit: "interruption" as const,
    },
  ])("resumes $recoveryKind after a cancellation $firstExit", async ({
    recoveryKind,
    firstExit,
  }) => {
    const result = await runAttachmentRedeliveryScenario({
      recoveryKind,
      firstExit,
    });

    expect(result.retry).toBe("cancelled");
    expect(result.cancellationAttempts).toBe(2);
    expect(result.row.reservationState).toBe("cancelled");
  });

  test.each([
    {
      label: "provider ID",
      row: {
        dotyposReservationId: "synthetic-other-provider",
        reservationState: "cancellation_failed" as const,
        failureCode: "synthetic_s5_cancellation_failure",
      },
    },
    {
      label: "creation timestamp",
      row: {
        dotyposReservationId: "synthetic-mismatch-provider",
        reservationState: "cancellation_failed" as const,
        reservationCreatedAt: now.subtract({ seconds: 1 }),
        failureCode: "synthetic_s5_cancellation_failure",
      },
    },
    {
      label: "epoch",
      row: {
        dotyposReservationId: "synthetic-mismatch-provider",
        reservationState: "cancelling" as const,
        failureCode: "attach_failed_cancel_failed:synthetic-other-epoch",
      },
    },
  ])("refuses unattached recovery with mismatched $label evidence", async ({
    row: rowOverrides,
  }) => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-mismatch-epoch";
    const providerId = "synthetic-mismatch-provider";
    const row = makeReservation({
      reservationCreatedAt: now,
      ...rowOverrides,
    });
    const cancelOrderHold = mock(() =>
      Effect.die("Mismatched evidence must not cancel")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "unattached",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: now,
    }).payload;

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(WorkspaceReservationRepository, {
              findById: mock(() => Effect.succeed(row)),
            } as unknown as WorkspaceReservationRepositoryType),
            Layer.succeed(ReservationHoldCleanupService, {
              cancelOrderHold,
              sweepExpiredHolds: mock(() =>
                Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
              ),
            } satisfies ReservationHoldCleanupServiceType),
            Layer.succeed(DotyposService, {} as never)
          )
        ),
        Effect.runPromise
      )
    ).rejects.toBeDefined();

    expect(cancelOrderHold).not.toHaveBeenCalled();
  });

  test.each([
    { recoveryKind: "unattached" as const, firstExit: "success" as const },
    {
      recoveryKind: "attachment_unknown" as const,
      firstExit: "success" as const,
    },
    {
      recoveryKind: "unattached" as const,
      firstExit: "commit_then_error" as const,
    },
    {
      recoveryKind: "attachment_unknown" as const,
      firstExit: "commit_then_error" as const,
    },
  ])("acknowledges duplicate $recoveryKind delivery after cancellation $firstExit", async ({
    recoveryKind,
    firstExit,
  }) => {
    const result = await runAttachmentRedeliveryScenario({
      recoveryKind,
      firstExit,
    });

    expect(result.retry).toBe("cancelled");
    expect(result.cancellationAttempts).toBe(1);
    expect(result.row.reservationState).toBe("cancelled");
  });

  test("acknowledges the queued exact result after immediate cancellation and safe draft release", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-released-epoch";
    const providerId = "synthetic-released-provider";
    const row = makeReservation({
      dotyposReservationId: null,
      reservationCreatedAt: null,
      reservationState: "draft",
      failureCode: null,
    });
    const cancelReservation = mock(() =>
      Effect.die("cancelled exact evidence must not be cancelled twice")
    );
    const createReservation = mock(() =>
      Effect.die("released redelivery must not create a provider reservation")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.succeed(row)),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() =>
              Effect.die("released draft must not enter local cancellation")
            ),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations: mock(() =>
              Effect.succeed([
                makeProviderEvidence({
                  id: providerId,
                  status: "CANCELLED",
                  orderId: row.id,
                  epoch,
                  customerId: row.dotyposCustomerId,
                }),
              ])
            ),
            cancelReservation,
            createReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(cancelReservation).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
    expect(row).toMatchObject({
      reservationState: "draft",
      dotyposReservationId: null,
      failureCode: null,
    });
  });

  test("keeps visibility-delayed orphan recovery durable and succeeds on queue retry", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-delay-epoch";
    const winnerId = "synthetic-delay-winner";
    const loserId = "synthetic-delay-loser";
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    let visible = false;
    const claim = mock((input) =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
        });
        return true;
      })
    );
    const release = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
        });
      })
    );
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
        });
      })
    );
    let loserStatus: "NEW" | "CANCELLED" = "NEW";
    const cancelReservation = mock(() =>
      Effect.sync(() => {
        loserStatus = "CANCELLED";
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: claim,
        beginDifferentProviderAttachmentCancellationVerification: mock(
          () => Effect.void
        ),
        releaseDifferentProviderAttachmentRecovery: release,
        completeDifferentProviderAttachmentRecovery: complete,
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          Effect.sync(() =>
            visible
              ? makeDefinitiveWinnerAndLoserEvidence({
                  reservation: row,
                  epoch,
                  winnerId,
                  loserId,
                  loserStatus,
                })
              : []
          )
        ),
        cancelReservation,
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(row.failureCode).toBe(
      `hold_creation_orphan_recovery:${epoch}:${loserId}`
    );
    expect(cancelReservation).not.toHaveBeenCalled();

    visible = true;
    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);
    expect(result).toBe("cancelled");
    expect(cancelReservation).toHaveBeenCalledTimes(1);
    expect(row.dotyposReservationId).toBe(winnerId);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}`
    );
  });

  test("does not resend a successful different-provider cancellation while visibility is stale", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-stale-visibility-epoch";
    const winnerId = "synthetic-stale-visibility-winner";
    const loserId = "synthetic-stale-visibility-loser";
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    const claim = mock((input) =>
      Effect.sync(() => {
        const awaitingVisibility = row.failureCode?.startsWith(
          `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:`
        );
        row = makeReservation({
          ...row,
          failureCode: awaitingVisibility
            ? `hold_creation_orphan_verifying:${epoch}:${loserId}:${now.epochMilliseconds}:${input.ownerId}`
            : `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
        });
        return true;
      })
    );
    const beginVerification = mock((input) =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_verifying:${epoch}:${loserId}:${now.epochMilliseconds}:${input.ownerId}`,
        });
      })
    );
    const release = mock(() =>
      Effect.sync(() => {
        const verificationStarted = row.failureCode?.startsWith(
          `hold_creation_orphan_verifying:${epoch}:${loserId}:`
        );
        row = makeReservation({
          ...row,
          failureCode: verificationStarted
            ? `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${now.epochMilliseconds}`
            : `hold_creation_orphan_recovery:${epoch}:${loserId}`,
        });
      })
    );
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
        });
      })
    );
    const cancelReservation = mock(() => Effect.void);
    let evidenceLookup = 0;
    const listReservations = mock(() => {
      evidenceLookup += 1;
      if (evidenceLookup === 2) {
        return Effect.fail(
          new Error("Synthetic provider visibility remained transient")
        );
      }
      return Effect.succeed(
        makeDefinitiveWinnerAndLoserEvidence({
          reservation: row,
          epoch,
          winnerId,
          loserId,
          loserStatus: evidenceLookup === 4 ? "CANCELLED" : "NEW",
        })
      );
    });
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: claim,
        beginDifferentProviderAttachmentCancellationVerification:
          beginVerification,
        releaseDifferentProviderAttachmentRecovery: release,
        completeDifferentProviderAttachmentRecovery: complete,
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations,
        cancelReservation,
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${now.epochMilliseconds}`
    );

    const redelivery = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);

    expect(redelivery).toBe("cancelled");
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}`
    );
    expect(cancelReservation).toHaveBeenCalledTimes(1);
  });

  test("does not resend after interruption while post-cancellation visibility is pending", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-post-cancellation-interruption-epoch";
    const winnerId = "synthetic-post-cancellation-interruption-winner";
    const loserId = "synthetic-post-cancellation-interruption-loser";
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}:${now.epochMilliseconds}`,
    });
    const claim = mock((input) =>
      Effect.sync(() => {
        const verificationOnly = row.failureCode?.startsWith(
          `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:`
        );
        row = makeReservation({
          ...row,
          failureCode: verificationOnly
            ? `hold_creation_orphan_verifying:${epoch}:${loserId}:${now.epochMilliseconds}:${input.ownerId}`
            : `hold_creation_orphan_processing:${epoch}:${loserId}:${now.epochMilliseconds}:${input.ownerId}`,
        });
        return true;
      })
    );
    const beginVerification = mock((input) =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_verifying:${epoch}:${loserId}:${now.epochMilliseconds}:${input.ownerId}`,
        });
      })
    );
    const release = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: row.failureCode?.startsWith(
            `hold_creation_orphan_verifying:${epoch}:${loserId}:`
          )
            ? `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${now.epochMilliseconds}`
            : `hold_creation_orphan_recovery:${epoch}:${loserId}:${now.epochMilliseconds}`,
        });
      })
    );
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}:${now.epochMilliseconds}`,
        });
      })
    );
    const cancelReservation = mock(() => Effect.void);
    let evidenceLookup = 0;
    const listReservations = mock(() => {
      evidenceLookup += 1;
      if (evidenceLookup === 2) return Effect.never;
      return Effect.succeed(
        makeDefinitiveWinnerAndLoserEvidence({
          reservation: row,
          epoch,
          winnerId,
          loserId,
          loserStatus: evidenceLookup === 4 ? "CANCELLED" : "NEW",
        })
      );
    });
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: claim,
        beginDifferentProviderAttachmentCancellationVerification:
          beginVerification,
        releaseDifferentProviderAttachmentRecovery: release,
        completeDifferentProviderAttachmentRecovery: complete,
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations,
        cancelReservation,
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.timeout("10 millis"),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(row.failureCode).toBe(
      `hold_creation_orphan_awaiting_visibility:${epoch}:${loserId}:${now.epochMilliseconds}`
    );

    const redelivery = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);

    expect(redelivery).toBe("cancelled");
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}:${now.epochMilliseconds}`
    );
    expect(cancelReservation).toHaveBeenCalledTimes(1);
  });

  test.each([
    {
      label: "typed provider failure",
      exitKind: "typed_failure" as const,
      retainOwnedVerification: false,
    },
    {
      label: "provider defect",
      exitKind: "defect" as const,
      retainOwnedVerification: false,
    },
    {
      label: "provider interruption",
      exitKind: "interruption" as const,
      retainOwnedVerification: false,
    },
    {
      label: "ambiguous transport with stale takeover",
      exitKind: "ambiguous_transport" as const,
      retainOwnedVerification: true,
    },
  ])("never resends after $label inside cancellation", async (scenario) => {
    const result =
      await runDifferentProviderCancellationBoundaryScenario(scenario);

    expect(result.redelivery).toBe("cancelled");
    expect(result.cancelReservation).toHaveBeenCalledTimes(1);
    expect(result.beginVerification).toHaveBeenCalledTimes(1);
    expect(result.complete).toHaveBeenCalledTimes(1);
    expect(result.listReservations).toHaveBeenCalledTimes(3);
    expect(result.completedOwnerId).toBeDefined();
    expect(result.completedOwnerId).not.toBe(result.firstOwnerId);
    expect(result.resolvedRecovery).toBe(
      `hold_creation_orphan_resolved:synthetic-${scenario.exitKind}-boundary-epoch:synthetic-${scenario.exitKind}-boundary-loser:${now.epochMilliseconds}`
    );
  });

  test.each([
    {
      label: "paid",
      paymentState: "paid" as const,
      failureCode: null,
    },
    {
      label: "terminal",
      paymentState: "failed" as const,
      failureCode: "synthetic_terminal_failure",
    },
  ])("re-proves cancelled loser evidence after $label lifecycle progression", async ({
    paymentState,
    failureCode,
  }) => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-terminal-redelivery-epoch";
    const winnerId = "synthetic-terminal-redelivery-winner";
    const loserId = "synthetic-terminal-redelivery-loser";
    const row = makeReservation({
      dotyposReservationId: winnerId,
      paymentState,
      failureCode,
    });
    const recordRecovery = mock(() =>
      Effect.fail(new Error("Lifecycle progression replaced recovery marker"))
    );
    const claimRecovery = mock(() =>
      Effect.die("markerless redelivery must not claim cancellation ownership")
    );
    const cancelReservation = mock(() =>
      Effect.die("cancelled evidence must not be deleted again")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.succeed(row)),
            recordDifferentProviderAttachmentRecovery: recordRecovery,
            claimDifferentProviderAttachmentRecovery: claimRecovery,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations: mock(() =>
              Effect.succeed([
                makeProviderEvidence({
                  id: loserId,
                  status: "CANCELLED",
                  orderId: row.id,
                  epoch,
                  customerId: row.dotyposCustomerId,
                }),
              ])
            ),
            cancelReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(recordRecovery).toHaveBeenCalledTimes(1);
    expect(claimRecovery).not.toHaveBeenCalled();
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("waits for cancelled visibility before acknowledging markerless redelivery", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-markerless-visibility-epoch";
    const winnerId = "synthetic-markerless-visibility-winner";
    const loserId = "synthetic-markerless-visibility-loser";
    const row = makeReservation({
      dotyposReservationId: winnerId,
      paymentState: "paid",
      failureCode: null,
    });
    let cancelledVisible = false;
    const cancelReservation = mock(() =>
      Effect.die("markerless redelivery must never issue cancellation")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.succeed(row)),
        recordDifferentProviderAttachmentRecovery: mock(() =>
          Effect.fail(new Error("Lifecycle progression replaced marker"))
        ),
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: loserId,
              status: cancelledVisible ? "CANCELLED" : "NEW",
              orderId: row.id,
              epoch,
              customerId: row.dotyposCustomerId,
            }),
          ])
        ),
        cancelReservation,
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(cancelReservation).not.toHaveBeenCalled();

    cancelledVisible = true;
    const retry = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);
    expect(retry).toBe("cancelled");
    expect(cancelReservation).not.toHaveBeenCalled();
  });

  test("keeps a live-owner message retryable until stale takeover can finish", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-stale-owner-epoch";
    const loserId = "synthetic-stale-owner-loser";
    let row = makeReservation({
      dotyposReservationId: "synthetic-stale-owner-winner",
      failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:original-owner`,
      updatedAt: now,
    });
    const claim = mock((input) =>
      Effect.sync(() => {
        if (
          Temporal.Instant.compare(row.updatedAt, input.staleBefore) > 0 &&
          !row.failureCode?.endsWith(`:${input.ownerId}`)
        ) {
          return false;
        }
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
          updatedAt: input.staleBefore.add({ minutes: 2 }),
        });
        return true;
      })
    );
    let loserStatus: "NEW" | "CANCELLED" = "NEW";
    const winnerId = row.dotyposReservationId!;
    const cancelReservation = mock(() =>
      Effect.sync(() => {
        loserStatus = "CANCELLED";
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: claim,
        beginDifferentProviderAttachmentCancellationVerification: mock(
          () => Effect.void
        ),
        releaseDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        completeDifferentProviderAttachmentRecovery: mock(() =>
          Effect.sync(() => {
            row = makeReservation({
              ...row,
              failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
            });
          })
        ),
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          Effect.succeed(
            makeDefinitiveWinnerAndLoserEvidence({
              reservation: row,
              epoch,
              winnerId,
              loserId,
              loserStatus,
            })
          )
        ),
        cancelReservation,
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(cancelReservation).not.toHaveBeenCalled();

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now.add({ minutes: 3 })
    ).pipe(Effect.provide(layer), Effect.runPromise);
    expect(result).toBe("cancelled");
    expect(cancelReservation).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}`
    );
  });

  test("retains a failed recovery release for bounded stale takeover", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-release-failure-epoch";
    const loserId = "synthetic-release-failure-loser";
    let visible = false;
    let row = makeReservation({
      dotyposReservationId: "synthetic-release-failure-winner",
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
      updatedAt: now,
    });
    const claim = mock((input) =>
      Effect.sync(() => {
        if (
          row.failureCode?.startsWith(
            `hold_creation_orphan_processing:${epoch}:${loserId}:`
          ) &&
          Temporal.Instant.compare(row.updatedAt, input.staleBefore) > 0 &&
          !row.failureCode.endsWith(`:${input.ownerId}`)
        ) {
          return false;
        }
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
          updatedAt: input.staleBefore.add({ minutes: 2 }),
        });
        return true;
      })
    );
    const release = mock(() =>
      Effect.fail(new Error("Synthetic release persistence failure"))
    );
    const winnerId = row.dotyposReservationId!;
    let loserStatus: "NEW" | "CANCELLED" = "NEW";
    const cancelReservation = mock(() =>
      Effect.sync(() => {
        loserStatus = "CANCELLED";
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: claim,
        beginDifferentProviderAttachmentCancellationVerification: mock(
          () => Effect.void
        ),
        releaseDifferentProviderAttachmentRecovery: release,
        completeDifferentProviderAttachmentRecovery: mock(() =>
          Effect.sync(() => {
            row = makeReservation({
              ...row,
              failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
            });
          })
        ),
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          visible
            ? Effect.succeed(
                makeDefinitiveWinnerAndLoserEvidence({
                  reservation: row,
                  epoch,
                  winnerId,
                  loserId,
                  loserStatus,
                })
              )
            : Effect.die(new Error("Synthetic recovery lookup defect"))
        ),
        cancelReservation,
      } as unknown as typeof DotyposService.Service)
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(release).toHaveBeenCalledTimes(1);
    await expect(
      processReservationHoldCleanupScheduleMessage(payload, now).pipe(
        Effect.provide(layer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(cancelReservation).not.toHaveBeenCalled();

    visible = true;
    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now.add({ minutes: 3 })
    ).pipe(Effect.provide(layer), Effect.runPromise);
    expect(result).toBe("cancelled");
    expect(cancelReservation).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}`
    );
  });

  test.each([
    "defect",
    "interruption",
  ] as const)("releases exact recovery ownership after a provider lookup %s", async (exitKind) => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = `synthetic-${exitKind}-release-epoch`;
    const loserId = `synthetic-${exitKind}-release-loser`;
    let shouldExit = true;
    let row = makeReservation({
      dotyposReservationId: `synthetic-${exitKind}-release-winner`,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    const claim = mock((input) =>
      Effect.sync(() => {
        if (
          row.failureCode !==
          `hold_creation_orphan_recovery:${epoch}:${loserId}`
        ) {
          return false;
        }
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
        });
        return true;
      })
    );
    const release = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
        });
      })
    );
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
        });
      })
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: claim,
        beginDifferentProviderAttachmentCancellationVerification: mock(
          () => Effect.void
        ),
        releaseDifferentProviderAttachmentRecovery: release,
        completeDifferentProviderAttachmentRecovery: complete,
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          shouldExit
            ? exitKind === "defect"
              ? Effect.die(new Error("Synthetic provider lookup defect"))
              : Effect.never
            : Effect.succeed([
                makeProviderEvidence({
                  id: row.dotyposReservationId!,
                  status: "NEW",
                  orderId: row.id,
                  epoch,
                  customerId: row.dotyposCustomerId,
                }),
                makeProviderEvidence({
                  id: loserId,
                  status: "CANCELLED",
                  orderId: row.id,
                  epoch,
                  customerId: row.dotyposCustomerId,
                }),
              ])
        ),
      } as unknown as typeof DotyposService.Service)
    );
    const first = processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(layer),
      ...(exitKind === "interruption" ? [Effect.timeout("10 millis")] : [])
    );

    await expect(Effect.runPromise(first)).rejects.toBeDefined();
    expect(release).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_recovery:${epoch}:${loserId}`
    );

    shouldExit = false;
    const retry = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);
    expect(retry).toBe("cancelled");
    expect(complete).toHaveBeenCalledTimes(1);
  });

  test("verifies recovery completion after a commit-then-error result", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-completion-ambiguity-epoch";
    const loserId = "synthetic-completion-ambiguity-loser";
    let row = makeReservation({
      dotyposReservationId: "synthetic-completion-ambiguity-winner",
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}`,
    });
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}`,
        });
      }).pipe(
        Effect.andThen(
          Effect.fail(new Error("Synthetic completion acknowledgement loss"))
        )
      )
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "different_provider",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: now,
    }).payload;
    const layer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, {
        findById: mock(() => Effect.sync(() => row)),
        recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        claimDifferentProviderAttachmentRecovery: mock((input) =>
          Effect.sync(() => {
            row = makeReservation({
              ...row,
              failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${input.ownerId}`,
            });
            return true;
          })
        ),
        beginDifferentProviderAttachmentCancellationVerification: mock(
          () => Effect.void
        ),
        releaseDifferentProviderAttachmentRecovery: mock(() => Effect.void),
        completeDifferentProviderAttachmentRecovery: complete,
      } as unknown as WorkspaceReservationRepositoryType),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: row.dotyposReservationId!,
              status: "NEW",
              orderId: row.id,
              epoch,
              customerId: row.dotyposCustomerId,
            }),
            makeProviderEvidence({
              id: loserId,
              status: "CANCELLED",
              orderId: row.id,
              epoch,
              customerId: row.dotyposCustomerId,
            }),
          ])
        ),
      } as unknown as typeof DotyposService.Service)
    );

    const first = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);
    const retry = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(Effect.provide(layer), Effect.runPromise);

    expect(first).toBe("cancelled");
    expect(retry).toBe("cancelled");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(row.dotyposReservationId).toBe(
      "synthetic-completion-ambiguity-winner"
    );
  });

  test("ignores invalid, not-due, changed-expiry, and completed reservations", async () => {
    const invalid = await runProcessMessage({ schemaVersion: 2 });
    expect(invalid.result).toBe("ignored");
    expect(invalid.findById).not.toHaveBeenCalled();

    const notDue = mock(() =>
      Effect.succeed(
        makeReservation({
          reservationHoldExpiresAt: Temporal.Instant.from(
            "2026-06-01T10:11:00.000Z"
          ),
        })
      )
    );
    const notDueResult = await runProcessMessage(duePayload, {
      findById: notDue,
    });
    expect(notDueResult.result).toBe("ignored");
    expect(notDueResult.cancelOrderHold).not.toHaveBeenCalled();

    for (const reservation of [
      makeReservation({ paymentState: "paid" }),
      makeReservation({ reservationState: "cancelled" }),
      makeReservation({ reservationState: "confirmed" }),
    ]) {
      const result = await runProcessMessage(duePayload, {
        findById: mock(() => Effect.succeed(reservation)),
      });
      expect(result.result).toBe("ignored");
      expect(result.cancelOrderHold).not.toHaveBeenCalled();
    }
  });

  test("cancels due reservation holds", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const result = await runProcessMessage(duePayload, {
      cancelOrderHold,
      now: dueNow,
    });

    expect(result.result).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "hold_expired",
      holdExpiredAt: dueNow,
    });

    for (const reservationState of [
      "cancelling",
      "cancellation_failed",
    ] as const) {
      const retryCancelOrderHold = mock(() =>
        Effect.succeed("cancelled" as const)
      );
      const retryResult = await runProcessMessage(duePayload, {
        cancelOrderHold: retryCancelOrderHold,
        findById: mock(() =>
          Effect.succeed(makeReservation({ reservationState }))
        ),
        now: dueNow,
      });

      expect(retryResult.result).toBe("cancelled");
      expect(retryCancelOrderHold).toHaveBeenCalledWith({
        orderId: "order-id",
        recoveryReason: "hold_expired",
        holdExpiredAt: dueNow,
      });
    }
  });

  test("keeps version-one hold-expiry messages recoverable", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("cancelled" as const));
    const result = await runProcessMessage(
      {
        schemaVersion: 1,
        orderId: "order-id",
        reservationHoldExpiresAtIso: expiresAt.toString(),
      },
      { cancelOrderHold, now: dueNow }
    );

    expect(result.result).toBe("cancelled");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "hold_expired",
      holdExpiredAt: dueNow,
    });
  });

  test("acks skipped cleanup while the reservation is still due", async () => {
    const cancelOrderHold = mock(() => Effect.succeed("skipped" as const));
    const findById = mock(() => Effect.succeed(makeReservation()));

    const result = await runProcessMessage(duePayload, {
      cancelOrderHold,
      findById,
      now: dueNow,
    });

    expect(result.result).toBe("skipped");
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: "order-id",
      recoveryReason: "hold_expired",
      holdExpiredAt: dueNow,
    });
    expect(findById).toHaveBeenCalledTimes(1);
  });

  test("redelivers an already-due cleanup after candidate stabilization", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      getReservationHoldCleanupScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-deduplicated-deadline-epoch";
    const providerId = "synthetic-deduplicated-deadline-provider";
    const createdAt = now.subtract({ minutes: 5 });
    const stabilizationDeadline = dueNow.add({ minutes: 2 });
    const stabilizationNow = stabilizationDeadline.add({ seconds: 1 });
    let row = makeReservation({
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate:${epoch}:${providerId}:${createdAt.epochMilliseconds}:${stabilizationDeadline.epochMilliseconds}`,
    });
    const deadlineMessage = getReservationHoldCleanupScheduleMessage(
      {
        orderId: row.id,
        reservationHoldExpiresAt:
          row.reservationHoldExpiresAt as Temporal.Instant,
      },
      dueNow
    );
    const acceptedIdentities = new Set([
      deadlineMessage.options.idempotencyKey,
    ]);
    const attemptedDeadlineIdentities: string[] = [];
    let acceptedDeadlineDeliveries = 1;
    const cancelOrderHold = mock(() =>
      Effect.sync(() =>
        row.failureCode?.startsWith("hold_creation_candidate:")
          ? ("skipped" as const)
          : ("cancelled" as const)
      )
    );
    const earlyDelivery = await runProcessMessage(deadlineMessage.payload, {
      cancelOrderHold,
      findById: mock(() => Effect.sync(() => row)),
      now: dueNow,
    });
    const completeProviderHoldCandidate = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_attached:${epoch}`,
        });
      })
    );
    const enqueueCleanup = mock((input) =>
      Effect.sync(() => {
        const retry = getReservationHoldCleanupScheduleMessage(
          input,
          stabilizationNow
        );
        attemptedDeadlineIdentities.push(retry.options.idempotencyKey);
        if (!acceptedIdentities.has(retry.options.idempotencyKey)) {
          acceptedIdentities.add(retry.options.idempotencyKey);
          acceptedDeadlineDeliveries += 1;
        }
      })
    );
    const stabilizationPayload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
      stabilizeCandidate: true,
    }).payload;

    const stabilizationResult =
      await processReservationHoldCleanupScheduleMessage(
        stabilizationPayload,
        stabilizationNow
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(WorkspaceReservationRepository, {
              findById: mock(() => Effect.sync(() => row)),
              completeProviderHoldCandidate,
            } as unknown as WorkspaceReservationRepositoryType),
            Layer.succeed(ReservationHoldCleanupScheduleService, {
              enqueueCleanup,
            }),
            Layer.succeed(ReservationHoldCleanupService, {
              cancelOrderHold: mock(() =>
                Effect.die("candidate stabilization must not cancel the winner")
              ),
              sweepExpiredHolds: mock(() =>
                Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
              ),
            } satisfies ReservationHoldCleanupServiceType),
            Layer.succeed(DotyposService, {
              listReservations: mock(() =>
                Effect.succeed([
                  makeProviderEvidence({
                    id: providerId,
                    status: "NEW",
                    orderId: row.id,
                    epoch,
                    customerId: row.dotyposCustomerId,
                  }),
                ])
              ),
            } as unknown as typeof DotyposService.Service)
          )
        ),
        Effect.runPromise
      );

    expect(earlyDelivery.result).toBe("skipped");
    expect(stabilizationResult).toBe("cancelled");
    expect(row.failureCode).toBe(`hold_creation_attached:${epoch}`);
    expect(attemptedDeadlineIdentities).toEqual([
      `${deadlineMessage.options.idempotencyKey}:provider-candidate-stabilized:${epoch}:${providerId}`,
    ]);
    expect(acceptedDeadlineDeliveries).toBe(2);
  });

  test("reverifies a stale attached candidate and schedules its original deadline without another create", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-stale-candidate-epoch";
    const providerId = "synthetic-stale-candidate-provider";
    const createdAt = Temporal.Instant.from("2026-06-01T09:54:00Z");
    let row = makeReservation({
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate:${epoch}:${providerId}:${createdAt.epochMilliseconds}`,
    });
    const complete = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          failureCode: `hold_creation_attached:${epoch}`,
        });
      })
    );
    const enqueueCleanup = mock(() => Effect.void);
    const createPreparedReservation = mock(() =>
      Effect.die("recovery must not create another provider reservation")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      dueNow
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            completeProviderHoldCandidate: complete,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          }),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() =>
              Effect.die("must not cancel candidate")
            ),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations: mock(() =>
              Effect.succeed([
                makeProviderEvidence({
                  id: providerId,
                  status: "NEW",
                  orderId: row.id,
                  epoch,
                  customerId: row.dotyposCustomerId,
                }),
              ])
            ),
            createPreparedReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(complete).toHaveBeenCalledTimes(1);
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "hold_expired",
      orderId: row.id,
      reservationHoldExpiresAt: expiresAt,
      stabilizedProviderCandidate: {
        providerCreationEpoch: epoch,
        dotyposReservationId: providerId,
      },
    });
    expect(createPreparedReservation).not.toHaveBeenCalled();
  });

  test("keeps a candidate payment-blocked when a delayed same-epoch loser becomes visible", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-delayed-loser-epoch";
    const winnerId = "synthetic-delayed-loser-winner";
    const loserId = "synthetic-delayed-loser-provider";
    const createdAt = Temporal.Instant.from("2026-06-01T09:54:00Z");
    const row = makeReservation({
      dotyposReservationId: winnerId,
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate:${epoch}:${winnerId}:${createdAt.epochMilliseconds}`,
    });
    const complete = mock(() => Effect.void);
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: winnerId,
      reservationCreatedAt: createdAt,
    }).payload;

    await expect(
      processReservationHoldCleanupScheduleMessage(payload, dueNow).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(WorkspaceReservationRepository, {
              findById: mock(() => Effect.succeed(row)),
              completeProviderHoldCandidate: complete,
            } as unknown as WorkspaceReservationRepositoryType),
            Layer.succeed(ReservationHoldCleanupScheduleService, {
              enqueueCleanup: mock(() => Effect.void),
            }),
            Layer.succeed(ReservationHoldCleanupService, {
              cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
              sweepExpiredHolds: mock(() =>
                Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
              ),
            } satisfies ReservationHoldCleanupServiceType),
            Layer.succeed(DotyposService, {
              listReservations: mock(() =>
                Effect.succeed([
                  makeProviderEvidence({
                    id: winnerId,
                    status: "NEW",
                    orderId: row.id,
                    epoch,
                    customerId: row.dotyposCustomerId,
                  }),
                  makeProviderEvidence({
                    id: loserId,
                    status: "NEW",
                    orderId: row.id,
                    epoch,
                    customerId: row.dotyposCustomerId,
                  }),
                ])
              ),
            } as unknown as typeof DotyposService.Service)
          )
        ),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    expect(complete).not.toHaveBeenCalled();
    expect(row.failureCode).toBe(
      `hold_creation_candidate:${epoch}:${winnerId}:${createdAt.epochMilliseconds}`
    );
  });

  test("recovers a persisted pre-attachment candidate without creating or cancelling its winner", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-pre-attachment-candidate-epoch";
    const providerId = "synthetic-pre-attachment-candidate-provider";
    const createdAt = Temporal.Instant.from("2026-06-01T10:00:00Z");
    let row = makeReservation({
      reservationState: "creating_hold",
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate:${epoch}:${providerId}:${createdAt.epochMilliseconds}`,
    });
    const attachHold = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          reservationState: "held",
          failureCode: `hold_creation_candidate:${epoch}:${providerId}:${createdAt.epochMilliseconds}:${dueNow.epochMilliseconds}`,
        });
      })
    );
    const enqueueCleanup = mock(() => Effect.void);
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      now
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            attachHold,
            claimHoldCreationCompensation: mock(() =>
              Effect.die("candidate recovery must not enter compensation")
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          }),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() =>
              Effect.die("candidate recovery must not cancel its winner")
            ),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations: mock(() =>
              Effect.succeed([
                makeProviderEvidence({
                  id: providerId,
                  status: "NEW",
                  orderId: row.id,
                  epoch,
                  customerId: row.dotyposCustomerId,
                }),
              ])
            ),
            createReservation: mock(() =>
              Effect.die("candidate recovery must not issue another create")
            ),
            cancelReservation: mock(() =>
              Effect.die("candidate recovery must not cancel its winner")
            ),
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(attachHold).toHaveBeenCalledTimes(1);
    expect(row.reservationState).toBe("held");
    expect(row.failureCode).toStartWith("hold_creation_candidate:");
    expect(enqueueCleanup).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "attachment_compensation",
        recoveryKind: "attachment_unknown",
        orderId: row.id,
      })
    );
  });

  test("composes ambiguity dedupe, delayed-loser recovery, and atomic payment admission", async () => {
    const {
      enqueueAttachmentCancellationCompensation,
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { WorkspaceDatabase } = await import("@/db/database.service");
    const { PaymentAttemptRepository, PaymentAttemptRepositoryLive } =
      await import(
        "@/features/checkout/backend/repositories/payment-attempt.repository"
      );
    const epoch = "synthetic-composed-ambiguity-epoch";
    const winnerId = "synthetic-composed-winner";
    const loserId = "synthetic-composed-loser";
    const winnerCreatedAt = now.subtract({ minutes: 1 });
    const loserCreatedAt = now;
    const stabilizationDeadline = now.add({ minutes: 2 });
    const candidateMarker = `hold_creation_candidate:${epoch}:${winnerId}:${winnerCreatedAt.epochMilliseconds}:${stabilizationDeadline.epochMilliseconds}`;
    const orphanSuffix = `:candidate:${winnerId}:${winnerCreatedAt.epochMilliseconds}:${stabilizationDeadline.epochMilliseconds}`;
    let row = makeReservation({
      dotyposReservationId: winnerId,
      reservationCreatedAt: winnerCreatedAt,
      failureCode: candidateMarker,
      updatedAt: now,
    });
    const queued: Parameters<
      ReservationHoldCleanupScheduleServiceType["enqueueCleanup"]
    >[0][] = [];
    const scheduledHolds: string[] = [];
    const paymentAttempts: unknown[] = [];
    let loserStatus: "NEW" | "CANCELLED" = "NEW";
    const cancelReservation = mock((providerId: string) =>
      Effect.sync(() => {
        expect(providerId).toBe(loserId);
        loserStatus = "CANCELLED";
      })
    );
    const createReservation = mock(() =>
      Effect.die("recovery must not create another provider reservation")
    );
    const repository = {
      findById: mock(() => Effect.sync(() => row)),
      recordProviderHoldCandidate: mock((input) =>
        Effect.suspend(() => {
          if (
            row.reservationState !== "held" ||
            row.paymentState !== "not_started" ||
            row.dotyposReservationId === input.dotyposReservationId ||
            row.failureCode !== candidateMarker
          ) {
            return Effect.fail(new Error("Synthetic candidate CAS rejected"));
          }
          row = makeReservation({
            ...row,
            failureCode: `hold_creation_orphan_recovery:${epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}${orphanSuffix}`,
          });
          return Effect.fail(
            new Error("Synthetic different-provider attachment conflict")
          );
        })
      ),
      recordDifferentProviderAttachmentRecovery: mock((input) =>
        Effect.suspend(() =>
          row.failureCode ===
          `hold_creation_orphan_recovery:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}${orphanSuffix}`
            ? Effect.void
            : Effect.fail(new Error("Synthetic orphan identity mismatch"))
        )
      ),
      claimDifferentProviderAttachmentRecovery: mock((input) =>
        Effect.sync(() => {
          const pending = `hold_creation_orphan_recovery:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}${orphanSuffix}`;
          const owned = `hold_creation_orphan_processing:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}:${input.ownerId}${orphanSuffix}`;
          if (row.failureCode !== pending && row.failureCode !== owned) {
            return false;
          }
          row = makeReservation({ ...row, failureCode: owned });
          return true;
        })
      ),
      beginDifferentProviderAttachmentCancellationVerification: mock(
        () => Effect.void
      ),
      releaseDifferentProviderAttachmentRecovery: mock((input) =>
        Effect.sync(() => {
          row = makeReservation({
            ...row,
            failureCode: `hold_creation_orphan_recovery:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}${orphanSuffix}`,
          });
        })
      ),
      completeDifferentProviderAttachmentRecovery: mock((input) =>
        Effect.sync(() => {
          const owned = `hold_creation_orphan_processing:${input.epoch}:${input.dotyposReservationId}:${input.reservationCreatedAt.epochMilliseconds}:${input.ownerId}${orphanSuffix}`;
          expect(row.failureCode).toBe(owned);
          expect(loserStatus).toBe("CANCELLED");
          row = makeReservation({
            ...row,
            failureCode: candidateMarker,
          });
        })
      ),
      completeProviderHoldCandidate: mock(() =>
        Effect.sync(() => {
          expect(row.failureCode).toBe(candidateMarker);
          row = makeReservation({
            ...row,
            failureCode: `hold_creation_attached:${epoch}`,
          });
        })
      ),
    } as unknown as WorkspaceReservationRepositoryType;
    const schedule = {
      enqueueCleanup: mock((input) =>
        Effect.sync(() => {
          if (input.reason === "attachment_compensation") queued.push(input);
          else scheduledHolds.push(input.orderId);
        })
      ),
    };
    const queueLayer = Layer.mergeAll(
      Layer.succeed(WorkspaceReservationRepository, repository),
      Layer.succeed(ReservationHoldCleanupScheduleService, schedule),
      Layer.succeed(ReservationHoldCleanupService, {
        cancelOrderHold: mock(() =>
          Effect.die("different-provider recovery must not cancel the winner")
        ),
        sweepExpiredHolds: mock(() =>
          Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
        ),
      } satisfies ReservationHoldCleanupServiceType),
      Layer.succeed(DotyposService, {
        listReservations: mock(() =>
          Effect.succeed([
            makeProviderEvidence({
              id: winnerId,
              status: "NEW",
              orderId: row.id,
              epoch,
              customerId: row.dotyposCustomerId,
            }),
            makeProviderEvidence({
              id: loserId,
              status: loserStatus,
              orderId: row.id,
              epoch,
              customerId: row.dotyposCustomerId,
            }),
          ])
        ),
        cancelReservation,
        createReservation,
      } as unknown as typeof DotyposService.Service)
    );
    const attemptPayment = () => {
      const transaction = (
        workflow: (transaction: unknown) => Effect.Effect<unknown>
      ) =>
        Effect.gen(function* () {
          const stagedAttempts = [...paymentAttempts];
          const stagedRow = { ...row };
          const transaction = {
            insert: () => ({
              values: (values: Record<string, unknown>) => ({
                returning: () =>
                  Effect.sync(() => {
                    const attempt = {
                      ...values,
                      id: "synthetic-composed-payment-attempt",
                      provider: "nexi",
                      state: "created",
                      createdAt: now,
                      updatedAt: now,
                    };
                    stagedAttempts.push(attempt);
                    return [attempt];
                  }),
              }),
            }),
            update: () => ({
              set: (values: Record<string, unknown>) => ({
                where: () => ({
                  returning: () =>
                    Effect.sync(() => {
                      const unresolved = [
                        "hold_creation_candidate:",
                        "hold_creation_candidate_compensating:",
                        "hold_creation_orphan_recovery:",
                        "hold_creation_orphan_processing:",
                      ].some((prefix) =>
                        stagedRow.failureCode?.startsWith(prefix)
                      );
                      if (unresolved) return [];
                      Object.assign(stagedRow, values);
                      return [{ id: stagedRow.id }];
                    }),
                }),
              }),
            }),
          };
          const result = yield* workflow(transaction);
          paymentAttempts.splice(0, paymentAttempts.length, ...stagedAttempts);
          row = makeReservation(stagedRow);
          return result;
        });
      return Effect.gen(function* () {
        const payments = yield* PaymentAttemptRepository;
        return yield* payments.create({
          workspaceReservationId: row.id,
          providerOrderId: "synthetic-composed-provider-order",
          amountValue: 1000,
          amountExponent: 2,
          currency: "CZK",
        });
      }).pipe(
        Effect.provide(
          PaymentAttemptRepositoryLive.pipe(
            Layer.provide(
              Layer.succeed(WorkspaceDatabase, {
                db: { transaction } as never,
              })
            )
          )
        )
      );
    };
    const winnerInput = {
      recoveryKind: "attachment_unknown" as const,
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: winnerId,
      reservationCreatedAt: winnerCreatedAt,
    };
    const immediate = getAttachmentCancellationScheduleMessage(winnerInput);
    const stabilization = getAttachmentCancellationScheduleMessage({
      ...winnerInput,
      stabilizeCandidate: true,
      delaySeconds: 120,
    });
    expect(immediate.options.idempotencyKey).not.toBe(
      stabilization.options.idempotencyKey
    );

    await expect(
      processReservationHoldCleanupScheduleMessage(immediate.payload, now).pipe(
        Effect.provide(queueLayer),
        Effect.runPromise
      )
    ).rejects.toBeDefined();
    await expect(
      attemptPayment().pipe(Effect.runPromise)
    ).rejects.toBeDefined();
    expect(paymentAttempts).toEqual([]);

    await enqueueAttachmentCancellationCompensation({
      recoveryKind: "attachment_unknown",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: loserId,
      reservationCreatedAt: loserCreatedAt,
    }).pipe(Effect.provide(queueLayer), Effect.runPromise);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_recovery:${epoch}:${loserId}:${loserCreatedAt.epochMilliseconds}${orphanSuffix}`
    );
    await expect(
      attemptPayment().pipe(Effect.runPromise)
    ).rejects.toBeDefined();
    expect(paymentAttempts).toEqual([]);

    const loserInput = queued.find(
      (input) =>
        input.reason === "attachment_compensation" &&
        input.dotyposReservationId === loserId
    );
    if (!loserInput || loserInput.reason !== "attachment_compensation") {
      throw new Error("Expected delayed-loser recovery payload.");
    }
    const loserResult = await processReservationHoldCleanupScheduleMessage(
      getAttachmentCancellationScheduleMessage(loserInput).payload,
      now.add({ seconds: 30 })
    ).pipe(Effect.provide(queueLayer), Effect.runPromise);
    expect(loserResult).toBe("cancelled");
    expect(cancelReservation).toHaveBeenCalledTimes(1);
    expect(row.failureCode).toBe(candidateMarker);
    await expect(
      attemptPayment().pipe(Effect.runPromise)
    ).rejects.toBeDefined();
    expect(paymentAttempts).toEqual([]);

    const winnerResult = await processReservationHoldCleanupScheduleMessage(
      stabilization.payload,
      stabilizationDeadline
    ).pipe(Effect.provide(queueLayer), Effect.runPromise);
    expect(winnerResult).toBe("cancelled");
    expect(scheduledHolds).toEqual([row.id]);

    await Effect.runPromise(attemptPayment());
    expect(paymentAttempts).toHaveLength(1);
    expect(createReservation).not.toHaveBeenCalled();
  });

  test("daily recovery re-enqueues stale candidate compensation and marker-only loser evidence", async () => {
    const {
      enqueuePendingProviderAttachmentRecoveries,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const createdAt = Temporal.Instant.from("2026-06-01T09:54:00Z");
    const candidate = makeReservation({
      reservationState: "creating_hold",
      dotyposReservationId: "synthetic-compensation-provider",
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate_compensating:synthetic-compensation-epoch:synthetic-compensation-provider:${createdAt.epochMilliseconds}`,
    });
    const pendingCandidate = makeReservation({
      id: "synthetic-pending-candidate-order",
      reservationState: "creating_hold",
      dotyposReservationId: "synthetic-pending-candidate-provider",
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate:synthetic-pending-candidate-epoch:synthetic-pending-candidate-provider:${createdAt.epochMilliseconds}`,
    });
    const orphan = makeReservation({
      id: "synthetic-orphan-order",
      dotyposReservationId: "synthetic-winner",
      failureCode: `hold_creation_orphan_recovery:synthetic-orphan-epoch:synthetic-loser:${createdAt.epochMilliseconds}`,
    });
    const enqueueCleanup = mock(() => Effect.void);

    const result = await enqueuePendingProviderAttachmentRecoveries({
      now: dueNow,
      limit: 25,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            selectPendingProviderAttachmentRecoveries: mock(() =>
              Effect.succeed([candidate, pendingCandidate, orphan])
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );

    expect(result).toEqual({ enqueued: 3, failed: 0 });
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      recoveryKind: "unattached",
      orderId: candidate.id,
      providerCreationEpoch: "synthetic-compensation-epoch",
      dotyposReservationId: "synthetic-compensation-provider",
      reservationCreatedAt: createdAt,
    });
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      recoveryKind: "attachment_unknown",
      orderId: pendingCandidate.id,
      providerCreationEpoch: "synthetic-pending-candidate-epoch",
      dotyposReservationId: "synthetic-pending-candidate-provider",
      reservationCreatedAt: createdAt,
      stabilizeCandidate: true,
    });
    expect(enqueueCleanup).toHaveBeenCalledWith({
      reason: "attachment_compensation",
      recoveryKind: "different_provider",
      orderId: orphan.id,
      providerCreationEpoch: "synthetic-orphan-epoch",
      dotyposReservationId: "synthetic-loser",
      reservationCreatedAt: createdAt,
    });
  });

  test("stale candidate compensation resumes only its exact verified hold without another create", async () => {
    const {
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-stale-compensation-epoch";
    const providerId = "synthetic-stale-compensation-provider";
    const createdAt = Temporal.Instant.from("2026-06-01T09:54:00Z");
    let row = makeReservation({
      reservationState: "creating_hold",
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
      failureCode: `hold_creation_candidate_compensating:${epoch}:${providerId}:${createdAt.epochMilliseconds}`,
    });
    const markRecovery = mock((input) =>
      Effect.sync(() => {
        expect(input).toMatchObject({
          epoch,
          dotyposReservationId: providerId,
          reservationCreatedAt: createdAt,
        });
        row = makeReservation({
          ...row,
          reservationState: "cancellation_failed",
          failureCode: `attach_failed_cancel_failed:${epoch}`,
        });
      })
    );
    const cancelOrderHold = mock(() =>
      Effect.sync(() => {
        row = makeReservation({
          ...row,
          reservationState: "cancelled",
        });
        return "cancelled" as const;
      })
    );
    const createPreparedReservation = mock(() =>
      Effect.die("compensation recovery must not create")
    );
    const payload = getAttachmentCancellationScheduleMessage({
      recoveryKind: "unattached",
      orderId: row.id,
      providerCreationEpoch: epoch,
      dotyposReservationId: providerId,
      reservationCreatedAt: createdAt,
    }).payload;

    const result = await processReservationHoldCleanupScheduleMessage(
      payload,
      dueNow
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            markAttachFailedCancellationRequired: markRecovery,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold,
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            createPreparedReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(markRecovery).toHaveBeenCalledTimes(1);
    expect(cancelOrderHold).toHaveBeenCalledWith({
      orderId: row.id,
      recoveryReason: "attachment_compensation",
    });
    expect(createPreparedReservation).not.toHaveBeenCalled();
  });

  test("daily recovery delivers a marker-only loser to exact cancellation and clears the blocker", async () => {
    const {
      enqueuePendingProviderAttachmentRecoveries,
      getAttachmentCancellationScheduleMessage,
      processReservationHoldCleanupScheduleMessage,
      ReservationHoldCleanupScheduleService,
    } = await import("./reservation-hold-cleanup-queue.service");
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const epoch = "synthetic-daily-orphan-epoch";
    const winnerId = "synthetic-daily-orphan-winner";
    const loserId = "synthetic-daily-orphan-loser";
    const createdAt = Temporal.Instant.from("2026-06-01T09:54:00Z");
    let row = makeReservation({
      dotyposReservationId: winnerId,
      failureCode: `hold_creation_orphan_recovery:${epoch}:${loserId}:${createdAt.epochMilliseconds}`,
      updatedAt: now.subtract({ minutes: 5 }),
    });
    let scheduled:
      | Parameters<typeof getAttachmentCancellationScheduleMessage>[0]
      | undefined;
    const enqueueCleanup = mock((input) =>
      Effect.sync(() => {
        if ("reason" in input) scheduled = input;
      })
    );
    const select = mock(() => Effect.succeed([row]));

    await enqueuePendingProviderAttachmentRecoveries({
      now: dueNow,
      limit: 25,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            selectPendingProviderAttachmentRecoveries: select,
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupScheduleService, {
            enqueueCleanup,
          })
        )
      ),
      Effect.runPromise
    );
    expect(scheduled).toBeDefined();

    let loserStatus: "NEW" | "CANCELLED" = "NEW";
    const cancelReservation = mock((id) =>
      Effect.sync(() => {
        expect(id).toBe(loserId);
        loserStatus = "CANCELLED";
      })
    );
    const result = await processReservationHoldCleanupScheduleMessage(
      getAttachmentCancellationScheduleMessage(scheduled!).payload,
      dueNow
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(WorkspaceReservationRepository, {
            findById: mock(() => Effect.sync(() => row)),
            recordDifferentProviderAttachmentRecovery: mock(() => Effect.void),
            claimDifferentProviderAttachmentRecovery: mock((input) =>
              Effect.sync(() => {
                row = makeReservation({
                  ...row,
                  failureCode: `hold_creation_orphan_processing:${epoch}:${loserId}:${createdAt.epochMilliseconds}:${input.ownerId}`,
                });
                return true;
              })
            ),
            beginDifferentProviderAttachmentCancellationVerification: mock(
              () => Effect.void
            ),
            releaseDifferentProviderAttachmentRecovery: mock(() => Effect.void),
            completeDifferentProviderAttachmentRecovery: mock(() =>
              Effect.sync(() => {
                row = makeReservation({
                  ...row,
                  failureCode: `hold_creation_orphan_resolved:${epoch}:${loserId}:${createdAt.epochMilliseconds}`,
                });
              })
            ),
          } as unknown as WorkspaceReservationRepositoryType),
          Layer.succeed(ReservationHoldCleanupService, {
            cancelOrderHold: mock(() => Effect.die("must not cancel winner")),
            sweepExpiredHolds: mock(() =>
              Effect.succeed({ cancelled: 0, skipped: 0, failed: 0 })
            ),
          } satisfies ReservationHoldCleanupServiceType),
          Layer.succeed(DotyposService, {
            listReservations: mock(() =>
              Effect.succeed(
                makeDefinitiveWinnerAndLoserEvidence({
                  reservation: row,
                  epoch,
                  winnerId,
                  loserId,
                  loserStatus,
                })
              )
            ),
            cancelReservation,
          } as unknown as typeof DotyposService.Service)
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("cancelled");
    expect(cancelReservation).toHaveBeenCalledTimes(1);
    expect(row.dotyposReservationId).toBe(winnerId);
    expect(row.failureCode).toBe(
      `hold_creation_orphan_resolved:${epoch}:${loserId}:${createdAt.epochMilliseconds}`
    );
  });

  test("vercel config wires the queue trigger and daily repair cron", async () => {
    const { reservationHoldCleanupQueueTopic } = await import(
      "./reservation-hold-cleanup-queue.service"
    );
    const config = await Bun.file(
      new URL("../../../../vercel.json", import.meta.url)
    ).json();

    expect(config.crons).toContainEqual({
      path: "/api/cron/workspace/reservation-holds",
      schedule: "0 0 * * *",
    });
    expect(
      config.functions[
        "app/api/queues/workspace/reservation-hold-cleanup/route.ts"
      ].experimentalTriggers
    ).toContainEqual({
      type: "queue/v2beta",
      topic: reservationHoldCleanupQueueTopic,
      retryAfterSeconds: 60,
      initialDelaySeconds: 0,
    });

    const queueRoute = await Bun.file(
      new URL(
        "../../../../app/api/queues/workspace/reservation-hold-cleanup/route.ts",
        import.meta.url
      )
    ).text();
    const cronRoute = await Bun.file(
      new URL(
        "../../../../app/api/cron/workspace/reservation-holds/route.ts",
        import.meta.url
      )
    ).text();
    expect(queueRoute).toContain(
      "processReservationHoldCleanupScheduleMessage(message)"
    );
    expect(cronRoute).toContain("cleanup.sweepExpiredHolds(input)");
  });
});
