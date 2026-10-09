import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import { makeCoworkInvoiceDocument } from "@/features/accounting/invoice.test-utils";
import { DiscountClaimError } from "@/features/discounts/errors";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { WorkspacePaidFulfillmentService } from "../fulfillment/paid-fulfillment.service";
import {
  LatePaymentRecoveryRepository,
  LatePaymentRecoveryStateError,
  OriginalHoldNotReusableError,
} from "../repositories/late-payment-recovery.repository";
import {
  TableAssignmentUnavailableError,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";

type OriginalHoldStatus = "NEW" | "CONFIRMED" | "CANCELLED";

type HarnessReservation = typeof coworkReservation & {
  readonly reservationState: string;
  readonly reservationHoldExpiresAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
};

const recovery = {
  paymentAttemptId: "attempt-id",
  workspaceReservationId: "reservation-id",
  originalDotyposReservationId: "dotypos-reservation-id",
};

/**
 * Wires the recovery service to stateful fakes so each test can assert the
 * order in which the original hold is released and the reservation recreated.
 */
const makeRecoveryHarness = (options: {
  readonly reservation: HarnessReservation;
  readonly originalStatus: OriginalHoldStatus;
  readonly newerReservation?: boolean;
  readonly ensureAvailable?: () => Effect.Effect<void, unknown>;
  readonly assignTableId?: () => Effect.Effect<unknown, unknown>;
  readonly cancelReservation?: () => Effect.Effect<void, unknown>;
  readonly completeUsingOriginalReservation?: () => Effect.Effect<
    void,
    unknown
  >;
}) => {
  const events: string[] = [];
  let reservation = { ...options.reservation };
  let recoveryState = "pending";
  const settleAs = (state: string) =>
    mock(() =>
      Effect.sync(() => {
        events.push(
          state === "recovered" ? "completeWithReplacement" : `settle:${state}`
        );
        recoveryState = state;
      })
    );
  const spies = {
    completeUsingOriginalReservation: mock(() => {
      events.push("completeUsingOriginalReservation");
      return (
        options.completeUsingOriginalReservation?.() ??
        Effect.sync(() => {
          recoveryState = "recovered";
        })
      );
    }),
    completeWithReplacement: settleAs("recovered"),
    requireRefund: settleAs("refund_required"),
    requireReview: settleAs("review_required"),
    claimCancellation: mock(() =>
      Effect.sync(() => {
        events.push("claimCancellation");
        reservation = { ...reservation, reservationState: "cancelling" };
        return reservation as never;
      })
    ),
    markCancelled: mock(() =>
      Effect.sync(() => {
        events.push("markCancelled");
        reservation = { ...reservation, reservationState: "cancelled" };
      })
    ),
    markCancellationFailed: mock(() =>
      Effect.sync(() => {
        events.push("markCancellationFailed");
        reservation = {
          ...reservation,
          reservationState: "cancellation_failed",
        };
      })
    ),
    getReservationStatus: mock(() =>
      Effect.sync(() => {
        events.push("getReservationStatus");
        return options.originalStatus;
      })
    ),
    cancelReservation: mock((id: string) => {
      events.push(`cancelReservation:${id}`);
      return options.cancelReservation?.() ?? Effect.void;
    }),
    ensureAvailable: mock(() => {
      events.push("ensureAvailable");
      return options.ensureAvailable?.() ?? Effect.void;
    }),
    assignTableId: mock(() => {
      events.push("assignTableId");
      return options.assignTableId?.() ?? Effect.succeed("table-id");
    }),
    createReservation: mock(() => {
      events.push("createReservation");
      return Effect.succeed({ id: "replacement-id" } as never);
    }),
    fulfillPaidOrder: mock(() => {
      events.push("fulfillPaidOrder");
      return Effect.void;
    }),
  };
  const snapshot = {
    ...makeCoworkInvoiceDocument("en-US"),
    workspaceReservationId: "reservation-id",
    dotyposReservationId: "dotypos-reservation-id",
    dotyposCustomerId: "dotypos-customer-id",
  } as never;
  const layer = LatePaymentRecoveryService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(LatePaymentRecoveryRepository, {
          findByPaymentAttemptId: mock(() =>
            Effect.sync(() => ({ ...recovery, state: recoveryState }) as never)
          ),
          claim: mock(() =>
            Effect.succeed({ ...recovery, state: "processing" } as never)
          ),
          hasNewerActiveReservation: mock(() =>
            Effect.succeed(options.newerReservation ?? false)
          ),
          completeUsingOriginalReservation:
            spies.completeUsingOriginalReservation as never,
          completeWithReplacement: spies.completeWithReplacement,
          requireRefund: spies.requireRefund,
          requireReview: spies.requireReview,
        }),
        Layer.mock(WorkspaceReservationRepository, {
          findById: mock(() => Effect.sync(() => reservation as never)),
          claimCancellation: spies.claimCancellation,
          markCancelled: spies.markCancelled,
          markCancellationFailed: spies.markCancellationFailed,
        }),
        Layer.mock(AccountingDocumentSnapshotRepository, {
          findByPaymentAttemptId: mock(() => Effect.succeed(snapshot)),
        }),
        Layer.mock(WorkspaceAvailabilityService, {
          ensureAvailable: spies.ensureAvailable as never,
        }),
        Layer.mock(DotyposService, {
          getReservationStatus: spies.getReservationStatus,
          cancelReservation: spies.cancelReservation as never,
          listActiveReservationsOverlapping: mock(() => Effect.succeed([])),
          createReservation: spies.createReservation,
        }),
        Layer.mock(WorkspaceTableAssignmentService, {
          assignTableId: spies.assignTableId as never,
        }),
        Layer.mock(WorkspacePaidFulfillmentService, {
          fulfillPaidOrder: spies.fulfillPaidOrder,
        })
      )
    )
  );
  const recover = () =>
    Effect.gen(function* () {
      const service = yield* LatePaymentRecoveryService;
      return yield* service.recover({
        paymentAttemptId: "attempt-id" as never,
      });
    }).pipe(Effect.provide(layer), Effect.result, Effect.runPromise);
  return { events, recover, spies };
};

const coworkReservation = {
  id: "reservation-id",
  activePaymentAttemptId: "attempt-id",
  dotyposCustomerId: "dotypos-customer-id",
  reservationDetails: { kind: "cowork", entryTier: "basic", coffee: true },
};

const expiredHeldReservation = {
  ...coworkReservation,
  reservationState: "held",
  reservationHoldExpiresAt: Temporal.Now.instant().subtract({ minutes: 20 }),
  updatedAt: Temporal.Now.instant().subtract({ minutes: 20 }),
};

const currentHeldReservation = {
  ...coworkReservation,
  reservationState: "held",
  reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
  updatedAt: Temporal.Now.instant(),
};

const releaseEvents = [
  "getReservationStatus",
  "claimCancellation",
  "cancelReservation:dotypos-reservation-id",
  "markCancelled",
];

const recreationEvents = [
  "ensureAvailable",
  "assignTableId",
  "createReservation",
  "completeWithReplacement",
  "fulfillPaidOrder",
];

describe("LatePaymentRecoveryService with an expired or released hold", () => {
  test("releases an expired hold that Dotypos still reports NEW and runs normal reservation creation", async () => {
    const harness = makeRecoveryHarness({
      reservation: expiredHeldReservation,
      originalStatus: "NEW",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(
      harness.spies.completeUsingOriginalReservation
    ).not.toHaveBeenCalled();
    expect(harness.events).toEqual([...releaseEvents, ...recreationEvents]);
    expect(harness.spies.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "CONFIRMED", tableId: "table-id" })
    );
    expect(harness.spies.completeWithReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveredDotyposReservationId: "replacement-id",
        reservationState: "confirmed",
      })
    );
  });

  test("requires a refund when the slot of an expired hold was taken", async () => {
    const harness = makeRecoveryHarness({
      reservation: expiredHeldReservation,
      originalStatus: "NEW",
      ensureAvailable: () =>
        Effect.fail(
          new WorkspaceTableUnavailableError({
            date: "2099-01-01",
            reservation: { kind: "cowork", entryTier: "basic" },
          })
        ),
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.events).toEqual([
      ...releaseEvents,
      "ensureAvailable",
      "settle:refund_required",
    ]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_reservation_unavailable",
      })
    );
  });

  test("requires a refund when table assignment finds no free table", async () => {
    const harness = makeRecoveryHarness({
      reservation: expiredHeldReservation,
      originalStatus: "NEW",
      assignTableId: () =>
        Effect.fail(
          new TableAssignmentUnavailableError({
            requiredTags: ["tier:basic"],
            message:
              "No available Dotypos workspace table matches tags: tier:basic",
          })
        ),
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.spies.createReservation).not.toHaveBeenCalled();
    expect(harness.spies.fulfillPaidOrder).not.toHaveBeenCalled();
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_reservation_unavailable",
      })
    );
  });

  test("releases and recreates a hold whose cleanup cancellation failed", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...currentHeldReservation,
        reservationState: "cancellation_failed",
      },
      originalStatus: "NEW",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(
      harness.spies.completeUsingOriginalReservation
    ).not.toHaveBeenCalled();
    expect(harness.events).toEqual([...releaseEvents, ...recreationEvents]);
  });

  test("reuses a current hold without releasing it", async () => {
    const harness = makeRecoveryHarness({
      reservation: currentHeldReservation,
      originalStatus: "NEW",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(harness.events).toEqual([
      "getReservationStatus",
      "completeUsingOriginalReservation",
      "fulfillPaidOrder",
    ]);
  });

  test("continues through release and recreation when the hold deadline passes during reuse", async () => {
    // 61 s remained at the first check, 59 s at the locked settlement.
    const harness = makeRecoveryHarness({
      reservation: currentHeldReservation,
      originalStatus: "NEW",
      completeUsingOriginalReservation: () =>
        Effect.fail(
          new OriginalHoldNotReusableError({
            paymentAttemptId: "attempt-id" as never,
            message: "The hold reached its reuse margin.",
          })
        ),
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(harness.events).toEqual([
      "getReservationStatus",
      "completeUsingOriginalReservation",
      ...releaseEvents,
      ...recreationEvents,
    ]);
    expect(harness.spies.requireRefund).not.toHaveBeenCalled();
  });

  test("keeps other settlement conflicts during reuse retryable", async () => {
    const harness = makeRecoveryHarness({
      reservation: currentHeldReservation,
      originalStatus: "NEW",
      completeUsingOriginalReservation: () =>
        Effect.fail(
          new LatePaymentRecoveryStateError({
            operation: "settle",
            paymentAttemptId: "attempt-id" as never,
            message: "A newer reservation prevents recovery.",
          })
        ),
    });

    const result = await harness.recover();

    expect(result._tag).toBe("Failure");
    expect(harness.spies.cancelReservation).not.toHaveBeenCalled();
    expect(harness.spies.requireRefund).not.toHaveBeenCalled();
    expect(harness.spies.fulfillPaidOrder).not.toHaveBeenCalled();
  });

  test("releases the original hold before refunding a superseded checkout reservation", async () => {
    const harness = makeRecoveryHarness({
      reservation: currentHeldReservation,
      originalStatus: "NEW",
      newerReservation: true,
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.events).toEqual([
      ...releaseEvents,
      "settle:refund_required",
    ]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "late_payment_newer_reservation" })
    );
  });

  test("releases a current hold before refunding an unavailable discount", async () => {
    const harness = makeRecoveryHarness({
      reservation: currentHeldReservation,
      originalStatus: "NEW",
      completeUsingOriginalReservation: () =>
        Effect.fail(
          new DiscountClaimError({
            operation: "redeem",
            reason: "usage_limit_reached",
            message: "The code has no remaining uses.",
          })
        ),
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.events).toEqual([
      "getReservationStatus",
      "completeUsingOriginalReservation",
      ...releaseEvents,
      "settle:refund_required",
    ]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_discount_unavailable",
      })
    );
  });

  test("keeps the recovery retryable when Dotypos cannot release the original hold", async () => {
    const harness = makeRecoveryHarness({
      reservation: expiredHeldReservation,
      originalStatus: "NEW",
      cancelReservation: () => Effect.fail(new Error("Dotypos unavailable")),
    });

    const result = await harness.recover();

    expect(result._tag).toBe("Failure");
    expect(harness.events).toEqual([
      "getReservationStatus",
      "claimCancellation",
      "cancelReservation:dotypos-reservation-id",
      "markCancellationFailed",
    ]);
    expect(harness.spies.requireRefund).not.toHaveBeenCalled();
    expect(harness.spies.createReservation).not.toHaveBeenCalled();
  });

  test("requires review instead of cancelling an expired hold that Dotypos reports confirmed", async () => {
    const harness = makeRecoveryHarness({
      reservation: expiredHeldReservation,
      originalStatus: "CONFIRMED",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "review_required",
    });
    expect(harness.spies.cancelReservation).not.toHaveBeenCalled();
    expect(harness.spies.claimCancellation).not.toHaveBeenCalled();
  });

  test("finishes a stale hold cancellation that a crashed run left behind", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...expiredHeldReservation,
        reservationState: "cancelling",
        updatedAt: Temporal.Now.instant().subtract({ hours: 1 }),
      },
      originalStatus: "NEW",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(harness.events).toEqual([
      "getReservationStatus",
      "cancelReservation:dotypos-reservation-id",
      "markCancelled",
      ...recreationEvents,
    ]);
  });

  test("waits for a fresh hold cancellation owned by cleanup", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...expiredHeldReservation,
        reservationState: "cancelling",
        updatedAt: Temporal.Now.instant(),
      },
      originalStatus: "NEW",
    });

    const result = await harness.recover();

    expect(result._tag).toBe("Failure");
    expect(harness.spies.cancelReservation).not.toHaveBeenCalled();
    expect(harness.spies.ensureAvailable).not.toHaveBeenCalled();
  });
});
