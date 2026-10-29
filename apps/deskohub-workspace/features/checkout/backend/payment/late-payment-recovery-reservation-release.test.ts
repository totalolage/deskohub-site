import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import { DiscountClaimError } from "@/features/discounts/errors";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import {
  LatePaymentRecoveryRepository,
  LatePaymentRecoveryStateError,
  OriginalHoldNotReusableError,
} from "../repositories/late-payment-recovery.repository";
import {
  TableAssignmentUnavailableError,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";
import {
  LatePaymentRecoveryService,
  latePaymentRecoveryMaxExecutionSeconds,
} from "./late-payment-recovery.service";

type OriginalHoldStatus = "NEW" | "CONFIRMED" | "CANCELLED";

type HarnessReservation = Omit<
  typeof coworkReservation,
  "reservationDetails"
> & {
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly reservationState: string;
  readonly failureCode?: string;
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
  /** False when another run holds a fresh processing claim. */
  readonly claimed?: boolean;
  readonly newerReservation?: boolean;
  /** A newer reservation wins between recreation and settlement. */
  readonly supersededAtSettlement?: boolean;
  /** A replacement an interrupted earlier run already created in Dotypos. */
  readonly resumedReplacementId?: string;
  readonly ensureAvailable?: () => Effect.Effect<void, unknown>;
  readonly assignTableId?: () => Effect.Effect<unknown, unknown>;
  /** The paid checkout's accounting document; a cowork one by default. */
  readonly invoiceDocument?: ReturnType<typeof makeMeetingRoomInvoiceDocument>;
  readonly cancelReservation?: () => Effect.Effect<void, unknown>;
  readonly completeUsingOriginalReservation?: () => Effect.Effect<
    void,
    unknown
  >;
}) => {
  const events: string[] = [];
  let reservation = { ...options.reservation };
  let recoveryState = "pending";
  let settlementAttempted = false;
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
    claim: mock(
      (_input: { readonly staleProcessingBefore: Temporal.Instant }) =>
        Effect.succeed(
          (options.claimed === false
            ? null
            : { ...recovery, state: "processing" }) as never
        )
    ),
    completeUsingOriginalReservation: mock(() => {
      events.push("completeUsingOriginalReservation");
      return (
        options.completeUsingOriginalReservation?.() ??
        Effect.sync(() => {
          recoveryState = "recovered";
        })
      );
    }),
    completeWithReplacement: options.supersededAtSettlement
      ? mock(() => {
          events.push("completeWithReplacement");
          settlementAttempted = true;
          return Effect.fail(
            new LatePaymentRecoveryStateError({
              operation: "settle",
              paymentAttemptId: "attempt-id" as never,
              message: "A newer reservation prevents recovery.",
            })
          );
        })
      : settleAs("recovered"),
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
    ...(options.invoiceDocument ?? makeCoworkInvoiceDocument("en-US")),
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
          claim: spies.claim,
          hasNewerActiveReservation: mock(() =>
            Effect.sync(
              () => (options.newerReservation ?? false) || settlementAttempted
            )
          ),
          completeUsingOriginalReservation:
            spies.completeUsingOriginalReservation as never,
          completeWithReplacement: spies.completeWithReplacement as never,
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
          listActiveReservationsOverlapping: mock(() =>
            Effect.succeed(
              (options.resumedReplacementId
                ? [
                    {
                      id: options.resumedReplacementId,
                      status: "CONFIRMED",
                      note: "Payment order: reservation-id",
                    },
                  ]
                : []) as never
            )
          ),
          createReservation: spies.createReservation,
        }),
        Layer.mock(WorkspaceTableAssignmentService, {
          assignTableId: spies.assignTableId as never,
        }),
        Layer.mock(ReservationFulfillment, {
          run: spies.fulfillPaidOrder,
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

  test("recreates an early-setup meeting room from its setup start", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...expiredHeldReservation,
        reservationDetails: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
          earlySetup: true,
        },
      },
      originalStatus: "NEW",
      // Booked 08:00–12:00 UTC.
      invoiceDocument: makeMeetingRoomInvoiceDocument("en-US"),
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(harness.spies.ensureAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        startsAt: "2099-02-03T07:45:00Z",
        endsAt: "2099-02-03T12:00:00Z",
      })
    );
    expect(harness.spies.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date("2099-02-03T07:45:00Z"),
        endDate: new Date("2099-02-03T12:00:00Z"),
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

  test("recreates a cancellation-failed hold that Dotypos already reports cancelled", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...currentHeldReservation,
        reservationState: "cancellation_failed",
      },
      originalStatus: "CANCELLED",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({ _tag: "Success", success: "recovered" });
    expect(harness.events).toEqual([
      "getReservationStatus",
      "claimCancellation",
      "markCancelled",
      ...recreationEvents,
    ]);
    expect(harness.spies.completeWithReplacement).toHaveBeenCalledWith(
      expect.objectContaining({
        recoveredDotyposReservationId: "replacement-id",
      })
    );
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
    // A processing claim only counts as stale once a run could have finished.
    const staleProcessingBefore =
      harness.spies.claim.mock.calls[0]?.[0].staleProcessingBefore;
    expect(
      Temporal.Now.instant().since(staleProcessingBefore).total("seconds")
    ).toBeGreaterThan(latePaymentRecoveryMaxExecutionSeconds);
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

describe("LatePaymentRecoveryService settlement decisions", () => {
  test("keeps a fresh processing claim retryable", async () => {
    const harness = makeRecoveryHarness({
      reservation: currentHeldReservation,
      originalStatus: "NEW",
      claimed: false,
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "LatePaymentRecoveryError" },
    });
    expect(harness.events).toEqual([]);
  });

  test("requires a refund instead of recreating an operator force-cancelled reservation", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...currentHeldReservation,
        reservationState: "cancelled",
        failureCode: "admin_forced_payment_cancellation",
      },
      originalStatus: "CANCELLED",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.events).toEqual(["settle:refund_required"]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_after_administration_cancellation",
      })
    );
  });

  test("requires a refund without disturbing a newer active payment attempt", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...currentHeldReservation,
        activePaymentAttemptId: "newer-attempt-id",
      },
      originalStatus: "NEW",
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.events).toEqual(["settle:refund_required"]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_superseded_attempt",
      })
    );
  });

  test("requires a refund when the purchased historical Profi monitor setup is unavailable", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...coworkReservation,
        reservationDetails: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption: "2x27-qhd",
        },
        reservationState: "cancelled",
        reservationHoldExpiresAt: Temporal.Now.instant(),
        updatedAt: Temporal.Now.instant(),
      } as HarnessReservation,
      originalStatus: "CANCELLED",
      ensureAvailable: () =>
        Effect.fail(
          new WorkspaceTableUnavailableError({
            date: "2099-01-01",
            reservation: {
              kind: "cowork",
              entryTier: "profi",
              monitorOption: "2x27-qhd",
            },
          })
        ),
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.spies.ensureAvailable).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "cowork",
        entryTier: "profi",
        monitorOption: "2x27-qhd",
      })
    );
    expect(harness.events).toEqual([
      "ensureAvailable",
      "settle:refund_required",
    ]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        failureCode: "late_payment_reservation_unavailable",
      })
    );
  });

  test("cancels a resumed replacement when a newer reservation wins before settlement", async () => {
    const harness = makeRecoveryHarness({
      reservation: {
        ...currentHeldReservation,
        reservationState: "cancelled",
      },
      originalStatus: "CANCELLED",
      resumedReplacementId: "replacement-id",
      supersededAtSettlement: true,
    });

    const result = await harness.recover();

    expect(result).toMatchObject({
      _tag: "Success",
      success: "refund_required",
    });
    expect(harness.events).toEqual([
      "completeWithReplacement",
      "cancelReservation:replacement-id",
      "settle:refund_required",
    ]);
    expect(harness.spies.requireRefund).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "late_payment_newer_reservation" })
    );
  });
});
