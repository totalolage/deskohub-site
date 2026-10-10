import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import {
  LatePaymentRecoveryRepository,
  LatePaymentRecoveryStateError,
} from "../repositories/late-payment-recovery.repository";
import { WorkspaceTableAssignmentService } from "../reservation/workspace-table-assignment.service";
import {
  LatePaymentRecoveryService,
  latePaymentRecoveryMaxExecutionSeconds,
} from "./late-payment-recovery.service";

const recovery = {
  paymentAttemptId: "attempt-id",
  workspaceReservationId: "reservation-id",
  state: "pending" as const,
  originalDotyposReservationId: "dotypos-reservation-id",
};

const heldReservation = {
  id: "reservation-id",
  activePaymentAttemptId: "attempt-id",
  reservationState: "held" as const,
  // Only a hold that has not reached its deadline may be reused.
  reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
};

describe("LatePaymentRecoveryService", () => {
  test("keeps a fresh processing claim retryable", async () => {
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed({ ...recovery, state: "processing" } as never)
            ),
            claim: mock(() => Effect.succeed(null)),
          }),
          Layer.mock(WorkspaceReservationRepository, {}),
          Layer.mock(AccountingDocumentSnapshotRepository, {}),
          Layer.mock(WorkspaceAvailabilityService, {}),
          Layer.mock(DotyposService, {}),
          Layer.mock(WorkspaceTableAssignmentService, {}),
          Layer.mock(WorkspacePaidFulfillmentService, {})
        )
      )
    );

    const result = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.result, Effect.provide(layer), Effect.runPromise);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("LatePaymentRecoveryError");
    }
  });

  test("restores a still-active original hold and continues paid fulfillment", async () => {
    const completeUsingOriginalReservation = mock(() => Effect.void);
    const fulfillPaidOrder = mock(() => Effect.void);
    const getReservationStatus = mock(() => Effect.succeed("NEW" as const));
    const claim = mock(() =>
      Effect.succeed({ ...recovery, state: "processing" } as never)
    );
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed(recovery as never)
            ),
            claim,
            hasNewerActiveReservation: mock(() => Effect.succeed(false)),
            completeUsingOriginalReservation,
          }),
          Layer.mock(WorkspaceReservationRepository, {
            findById: mock(() => Effect.succeed(heldReservation as never)),
          }),
          Layer.mock(AccountingDocumentSnapshotRepository, {
            findByPaymentAttemptId: mock(() => Effect.die("unused")),
          }),
          Layer.mock(WorkspaceAvailabilityService, {
            ensureAvailable: mock(() => Effect.die("unused")),
          }),
          Layer.mock(DotyposService, { getReservationStatus }),
          Layer.mock(WorkspaceTableAssignmentService, {}),
          Layer.mock(WorkspacePaidFulfillmentService, { fulfillPaidOrder })
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(outcome).toBe("recovered");
    expect(completeUsingOriginalReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAttemptId: "attempt-id",
        workspaceReservationId: "reservation-id",
        reservationState: "held",
      })
    );
    expect(getReservationStatus).toHaveBeenCalledWith("dotypos-reservation-id");
    const staleProcessingBefore = claim.mock.calls[0]?.[0]
      .staleProcessingBefore as Temporal.Instant;
    expect(
      Temporal.Now.instant().since(staleProcessingBefore).total("seconds")
    ).toBeGreaterThan(latePaymentRecoveryMaxExecutionSeconds);
    expect(fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-id",
    });
  });

  test("requires a refund instead of recreating an operator force-cancelled reservation", async () => {
    const requireRefund = mock(() => Effect.void);
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed(recovery as never)
            ),
            claim: mock(() =>
              Effect.succeed({ ...recovery, state: "processing" } as never)
            ),
            requireRefund,
          }),
          Layer.mock(WorkspaceReservationRepository, {
            findById: mock(() =>
              Effect.succeed({
                ...heldReservation,
                failureCode: "admin_forced_payment_cancellation",
                reservationState: "cancelled",
              } as never)
            ),
          }),
          Layer.mock(AccountingDocumentSnapshotRepository, {}),
          Layer.mock(WorkspaceAvailabilityService, {}),
          Layer.mock(DotyposService, {}),
          Layer.mock(WorkspaceTableAssignmentService, {}),
          Layer.mock(WorkspacePaidFulfillmentService, {})
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(outcome).toBe("refund_required");
    expect(requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_after_administration_cancellation",
      })
    );
  });

  test("requires a refund when the purchased historical Profi monitor setup is unavailable", async () => {
    const requireRefund = mock(() => Effect.void);
    const ensureAvailable = mock(() =>
      Effect.fail(
        new WorkspaceTableUnavailableError({
          date: "2099-01-01",
          reservation: {
            kind: "cowork",
            entryTier: "profi",
            monitorOption: "2x27-qhd",
          },
        })
      )
    );
    const assignTableId = mock(() =>
      Effect.die("an unavailable reservation must not be assigned")
    );
    const fulfillPaidOrder = mock(() =>
      Effect.die("an unavailable reservation must not be fulfilled")
    );
    const snapshot = {
      ...makeCoworkInvoiceDocument("en-US"),
      reservation: {
        kind: "cowork",
        date: "2099-01-01",
      },
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    } as never;
    const cancelledReservation = {
      id: "reservation-id",
      activePaymentAttemptId: "attempt-id",
      reservationState: "cancelled",
      dotyposCustomerId: "dotypos-customer-id",
      reservationDetails: {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
    };
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed(recovery as never)
            ),
            claim: mock(() =>
              Effect.succeed({ ...recovery, state: "processing" } as never)
            ),
            hasNewerActiveReservation: mock(() => Effect.succeed(false)),
            requireRefund,
          }),
          Layer.mock(WorkspaceReservationRepository, {
            findById: mock(() => Effect.succeed(cancelledReservation as never)),
          }),
          Layer.mock(AccountingDocumentSnapshotRepository, {
            findByPaymentAttemptId: mock(() => Effect.succeed(snapshot)),
          }),
          Layer.mock(WorkspaceAvailabilityService, { ensureAvailable }),
          Layer.mock(DotyposService, {
            listActiveReservationsOverlapping: mock(() => Effect.succeed([])),
          }),
          Layer.mock(WorkspaceTableAssignmentService, { assignTableId }),
          Layer.mock(WorkspacePaidFulfillmentService, { fulfillPaidOrder })
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(outcome).toBe("refund_required");
    expect(ensureAvailable).toHaveBeenCalledWith({
      kind: "cowork",
      date: "2099-01-01",
      entryTier: "profi",
      monitorOption: "2x27-qhd",
    });
    expect(requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_reservation_unavailable",
      })
    );
    expect(assignTableId).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  test("requires a refund without disturbing a newer active payment attempt", async () => {
    const requireRefund = mock(() => Effect.void);
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed(recovery as never)
            ),
            claim: mock(() =>
              Effect.succeed({ ...recovery, state: "processing" } as never)
            ),
            requireRefund,
          }),
          Layer.mock(WorkspaceReservationRepository, {
            findById: mock(() =>
              Effect.succeed({
                ...heldReservation,
                activePaymentAttemptId: "newer-attempt-id",
              } as never)
            ),
          }),
          Layer.mock(AccountingDocumentSnapshotRepository, {}),
          Layer.mock(WorkspaceAvailabilityService, {}),
          Layer.mock(DotyposService, {}),
          Layer.mock(WorkspaceTableAssignmentService, {}),
          Layer.mock(WorkspacePaidFulfillmentService, {})
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(outcome).toBe("refund_required");
    expect(requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_superseded_attempt",
      })
    );
  });

  test("recreates a cancellation-failed reservation after Dotypos reports it cancelled", async () => {
    const completeWithReplacement = mock(() => Effect.void);
    const fulfillPaidOrder = mock(() => Effect.void);
    const createReservation = mock(() =>
      Effect.succeed({ id: "replacement-id" } as never)
    );
    const snapshot = {
      ...makeCoworkInvoiceDocument("en-US"),
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    } as never;
    const cancelledReservation = {
      id: "reservation-id",
      activePaymentAttemptId: "attempt-id",
      reservationState: "cancellation_failed",
      dotyposCustomerId: "dotypos-customer-id",
      reservationDetails: {
        kind: "cowork",
        entryTier: "basic",
        coffee: true,
      },
    };
    let findRecoveryCall = 0;
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed(
                (findRecoveryCall++ === 0
                  ? recovery
                  : { ...recovery, state: "recovered" }) as never
              )
            ),
            claim: mock(() =>
              Effect.succeed({ ...recovery, state: "processing" } as never)
            ),
            hasNewerActiveReservation: mock(() => Effect.succeed(false)),
            completeWithReplacement,
          }),
          Layer.mock(WorkspaceReservationRepository, {
            findById: mock(() => Effect.succeed(cancelledReservation as never)),
            claimCancellation: mock(() =>
              Effect.succeed(cancelledReservation as never)
            ),
            markCancelled: mock(() => Effect.void),
          }),
          Layer.mock(AccountingDocumentSnapshotRepository, {
            findByPaymentAttemptId: mock(() => Effect.succeed(snapshot)),
          }),
          Layer.mock(WorkspaceAvailabilityService, {
            ensureAvailable: mock(() => Effect.void),
          }),
          Layer.mock(DotyposService, {
            getReservationStatus: mock(() =>
              Effect.succeed("CANCELLED" as const)
            ),
            listActiveReservationsOverlapping: mock(() => Effect.succeed([])),
            createReservation,
          }),
          Layer.mock(WorkspaceTableAssignmentService, {
            assignTableId: mock(() => Effect.succeed("table-id")),
          }),
          Layer.mock(WorkspacePaidFulfillmentService, { fulfillPaidOrder })
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(outcome).toBe("recovered");
    expect(createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONFIRMED" })
    );
    expect(completeWithReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveredDotyposReservationId: "replacement-id",
      })
    );
    expect(fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-id",
    });
  });

  test("cancels a resumed replacement when a newer reservation wins before settlement", async () => {
    const cancelReservation = mock(() => Effect.void);
    const requireRefund = mock(() => Effect.void);
    const snapshot = {
      ...makeCoworkInvoiceDocument("en-US"),
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
    } as never;
    let findRecoveryCall = 0;
    let supersessionCheck = 0;
    const layer = LatePaymentRecoveryService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(LatePaymentRecoveryRepository, {
            findByPaymentAttemptId: mock(() =>
              Effect.succeed(
                (findRecoveryCall++ === 0
                  ? recovery
                  : { ...recovery, state: "refund_required" }) as never
              )
            ),
            claim: mock(() =>
              Effect.succeed({ ...recovery, state: "processing" } as never)
            ),
            hasNewerActiveReservation: mock(() =>
              Effect.succeed(supersessionCheck++ > 0)
            ),
            completeWithReplacement: mock(() =>
              Effect.fail(
                new LatePaymentRecoveryStateError({
                  operation: "settle",
                  paymentAttemptId: "attempt-id" as never,
                  message: "superseded",
                })
              )
            ),
            requireRefund,
          }),
          Layer.mock(WorkspaceReservationRepository, {
            findById: mock(() =>
              Effect.succeed({
                id: "reservation-id",
                activePaymentAttemptId: "attempt-id",
                reservationState: "cancelled",
                dotyposCustomerId: "dotypos-customer-id",
                reservationDetails: {
                  kind: "cowork",
                  entryTier: "basic",
                  coffee: true,
                },
              } as never)
            ),
          }),
          Layer.mock(AccountingDocumentSnapshotRepository, {
            findByPaymentAttemptId: mock(() => Effect.succeed(snapshot)),
          }),
          Layer.mock(WorkspaceAvailabilityService, {}),
          Layer.mock(DotyposService, {
            listActiveReservationsOverlapping: mock(() =>
              Effect.succeed([
                {
                  id: "replacement-id",
                  status: "CONFIRMED",
                  note: "Payment order: reservation-id",
                },
              ] as never)
            ),
            cancelReservation,
          }),
          Layer.mock(WorkspaceTableAssignmentService, {}),
          Layer.mock(WorkspacePaidFulfillmentService, {})
        )
      )
    );

    const outcome = await Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({ paymentAttemptId: "attempt-id" });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(outcome).toBe("refund_required");
    expect(cancelReservation).toHaveBeenCalledWith("replacement-id");
    expect(requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "late_payment_newer_reservation" })
    );
  });
});
