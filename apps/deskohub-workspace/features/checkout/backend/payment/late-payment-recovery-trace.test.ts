import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService, DotyposUnavailable } from "@deskohub/dotypos";
import { Cause, Effect, Exit, Layer, Predicate } from "effect";
import { AccountingDocumentSnapshotRepository } from "@/features/accounting/backend/accounting-document-snapshot.repository";
import {
  makeCoworkInvoiceDocument,
  makeMeetingRoomInvoiceDocument,
  makeOfficeInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import { DiscountClaimError } from "@/features/discounts/errors";
import {
  WorkspaceAvailabilityService,
  WorkspaceTableUnavailableError,
} from "@/features/reservation/backend/workspace-availability.service";
import {
  WorkspaceReservationRepository,
  WorkspaceReservationStateError,
} from "@/features/reservation/backend/workspace-reservation.repository";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";
import { ReservationFulfillment } from "../fulfillment/reservation-fulfillment.service";
import { DotyposHoldRelease } from "../holds/dotypos-hold-release.service";
import {
  LatePaymentRecoveryRepository,
  LatePaymentRecoveryStateError,
  OriginalHoldNotReusableError,
} from "../repositories/late-payment-recovery.repository";
import { administrationForcedPaymentCancellationFailureCode } from "../repositories/payment-lifecycle.repository";
import {
  TableAssignmentUnavailableError,
  WorkspaceTableAssignmentService,
} from "../reservation/workspace-table-assignment.service";
import { LatePaymentRecoveryService } from "./late-payment-recovery.service";

interface Row {
  readonly id: string;
  readonly activePaymentAttemptId: string;
  readonly dotyposCustomerId: string;
  readonly failureCode: string | null;
  readonly reservationDetails: StoredWorkspaceReservationDetails;
  readonly reservationState: string;
  readonly reservationHoldExpiresAt: Temporal.Instant;
  readonly updatedAt: Temporal.Instant;
}
type Step = () => Effect.Effect<unknown, unknown>;

interface Scenario {
  /** The recovery's stored state; null when no recovery exists. */
  readonly recoveryState?: string | null;
  readonly claimed?: boolean;
  readonly reservation?: Row | null;
  /** Overrides each `findById` in turn; later reads use the stateful row. */
  readonly findByIdSequence?: ReadonlyArray<Row | null>;
  readonly originalStatus?: string;
  /** Each `hasNewerActiveReservation` answer in turn; the last one repeats. */
  readonly newerReservation?: ReadonlyArray<boolean>;
  readonly snapshot?: ReturnType<typeof makeCoworkInvoiceDocument> | null;
  readonly overlapping?: ReadonlyArray<{
    readonly id: string;
    readonly status: string;
    readonly note: string | null;
  }>;
  readonly createdId?: string;
  readonly claimCancellation?: boolean;
  readonly ensureAvailable?: Step;
  readonly assignTableId?: Step;
  readonly cancelReservation?: Step;
  readonly markCancelled?: (row: { current: Row | null }) => Step;
  readonly completeUsingOriginalReservation?: Step;
  readonly completeWithReplacement?: Step;
}

const recoveryRow = {
  paymentAttemptId: "attempt-id",
  workspaceReservationId: "reservation-id",
  originalDotyposReservationId: "dotypos-reservation-id",
};

const coworkRow = {
  id: "reservation-id",
  activePaymentAttemptId: "attempt-id",
  dotyposCustomerId: "dotypos-customer-id",
  failureCode: null,
  reservationDetails: { kind: "cowork", entryTier: "basic", coffee: true },
};

const expiredHeld: Row = {
  ...coworkRow,
  reservationState: "held",
  reservationHoldExpiresAt: Temporal.Now.instant().subtract({ minutes: 20 }),
  updatedAt: Temporal.Now.instant().subtract({ minutes: 20 }),
};

const currentHeld: Row = {
  ...coworkRow,
  reservationState: "held",
  reservationHoldExpiresAt: Temporal.Now.instant().add({ minutes: 5 }),
  updatedAt: Temporal.Now.instant(),
};

const withSnapshotKeys = (
  document: ReturnType<typeof makeCoworkInvoiceDocument>
) => ({
  ...document,
  workspaceReservationId: "reservation-id",
  dotyposReservationId: "dotypos-reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
});

const succeed =
  <A>(value: A) =>
  () =>
    Effect.succeed(value as never);
const fail =
  <E>(error: E) =>
  () =>
    Effect.fail(error as never);

const recoveryStateError = new LatePaymentRecoveryStateError({
  operation: "settle",
  paymentAttemptId: "attempt-id" as never,
  message: "A newer reservation prevents recovery.",
});

const discountClaimError = new DiscountClaimError({
  operation: "redeem",
  reason: "usage_limit_reached",
  message: "The code has no remaining uses.",
});

const reservationStateError = new WorkspaceReservationStateError({
  operation: "markCancelled",
  reservationId: "reservation-id" as never,
  message: "The reservation is no longer cancelling.",
});

/**
 * Wires the recovery to stateful fakes: cancellation and settlement writes
 * change what later reads return, as the repositories would.
 */
const recover = async (scenario: Scenario) => {
  const trace: EffectTrace = startEffectTrace();
  const row = {
    current: (scenario.reservation === undefined
      ? expiredHeld
      : scenario.reservation) as Row | null,
  };
  let recoveryState =
    scenario.recoveryState === undefined ? "pending" : scenario.recoveryState;
  const findByIdSequence = [...(scenario.findByIdSequence ?? [])];
  const newerAnswers = [...(scenario.newerReservation ?? [false])];
  const settleAs = (state: string) => () =>
    Effect.sync(() => {
      recoveryState = state;
    });
  const setRow = (changes: Partial<Row>) => () =>
    Effect.sync(() => {
      row.current = { ...row.current, ...changes };
      return row.current as never;
    });
  const calls = {
    ensureAvailable: mock(scenario.ensureAvailable ?? succeed(undefined)),
    createReservation: mock(
      succeed({ id: scenario.createdId ?? "replacement-id" })
    ),
  };
  const recoveries = trace.recordCalls("recoveries", {
    findByPaymentAttemptId: () =>
      Effect.sync(
        () =>
          (recoveryState === null
            ? null
            : { ...recoveryRow, state: recoveryState }) as never
      ),
    claim: succeed(
      scenario.claimed === false
        ? null
        : { ...recoveryRow, state: "processing" }
    ),
    hasNewerActiveReservation: () =>
      Effect.sync(() =>
        newerAnswers.length > 1 ? newerAnswers.shift() : newerAnswers[0]
      ),
    completeUsingOriginalReservation:
      scenario.completeUsingOriginalReservation ?? settleAs("recovered"),
    completeWithReplacement:
      scenario.completeWithReplacement ?? settleAs("recovered"),
    requireRefund: settleAs("refund_required"),
    requireReview: settleAs("review_required"),
  });
  const reservations = trace.recordCalls("reservations", {
    findById: () =>
      Effect.sync(() =>
        findByIdSequence.length > 0
          ? (findByIdSequence.shift() as never)
          : (row.current as never)
      ),
    claimCancellation:
      scenario.claimCancellation === false
        ? succeed(null)
        : setRow({ reservationState: "cancelling" }),
    markCancelled:
      scenario.markCancelled?.(row) ??
      setRow({ reservationState: "cancelled" }),
    markCancellationFailed: setRow({ reservationState: "cancellation_failed" }),
  });
  const dotypos = trace.recordCalls("dotypos", {
    getReservationStatus: succeed(scenario.originalStatus ?? "NEW"),
    cancelReservation: scenario.cancelReservation ?? succeed(undefined),
    listActiveReservationsOverlapping: succeed(scenario.overlapping ?? []),
    createReservation: calls.createReservation,
  });
  const snapshot =
    scenario.snapshot === null
      ? null
      : withSnapshotKeys(
          scenario.snapshot ?? makeCoworkInvoiceDocument("en-US")
        );

  const exit = await Effect.gen(function* () {
    const service = yield* LatePaymentRecoveryService;
    return yield* recordEffectTrace(
      trace,
      service.recover({ paymentAttemptId: "attempt-id" as never })
    );
  }).pipe(
    Effect.provide(
      LatePaymentRecoveryService.Default.pipe(
        Layer.provide(DotyposHoldRelease.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(LatePaymentRecoveryRepository, recoveries as never),
            Layer.mock(WorkspaceReservationRepository, reservations as never),
            Layer.mock(AccountingDocumentSnapshotRepository, {
              findByPaymentAttemptId: trace.recordCalls("snapshots", {
                findByPaymentAttemptId: succeed(snapshot),
              }).findByPaymentAttemptId,
            }),
            Layer.mock(WorkspaceAvailabilityService, {
              ensureAvailable: trace.recordCalls("availability", {
                ensureAvailable: calls.ensureAvailable,
              }).ensureAvailable as never,
            }),
            Layer.mock(DotyposService, dotypos as never),
            Layer.mock(WorkspaceTableAssignmentService, {
              assignTableId: trace.recordCalls("tableAssignments", {
                assignTableId: scenario.assignTableId ?? succeed("table-id"),
              }).assignTableId as never,
            }),
            Layer.mock(ReservationFulfillment, {
              run: trace.recordCalls("fulfillment", {
                run: succeed(undefined),
              }).run,
            })
          )
        )
      )
    ),
    Effect.runPromise
  );
  return {
    outcome: outcomeOf(exit),
    trace: trace.entries,
    calls,
  };
};

/** The success value, or the failure's message, or the defect. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  const kind = Cause.hasDies(exit.cause) ? "die" : "fail";
  return `${kind}: ${Predicate.hasProperty(failure, "message") ? failure.message : String(failure)}`;
};

describe("LatePaymentRecoveryService.recover settled recoveries", () => {
  test("ignores a payment attempt without a recovery", async () => {
    const { outcome, trace } = await recover({ recoveryState: null });

    expect(outcome).toBe("ignored");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });

  test("re-runs fulfillment for a recovered reservation", async () => {
    const { outcome, trace } = await recover({ recoveryState: "recovered" });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("keeps a recovery that ended requiring a refund", async () => {
    const { outcome, trace } = await recover({
      recoveryState: "refund_required",
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });

  test("keeps a recovery that ended requiring review", async () => {
    const { outcome, trace } = await recover({
      recoveryState: "review_required",
    });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });

  test("retries a recovery another run is processing", async () => {
    const { outcome, trace } = await recover({ claimed: false });

    expect(outcome).toBe("fail: Late-payment recovery is already processing.");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
      ]
    `);
  });

  test("dies when the claimed recovery's reservation is missing", async () => {
    const { outcome, trace } = await recover({ reservation: null });

    expect(outcome).toBe(
      "die: Late-payment recovery reservation missing despite its foreign key."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  test("refunds a payment whose attempt was superseded", async () => {
    const { outcome, trace } = await recover({
      reservation: { ...expiredHeld, activePaymentAttemptId: "newer-attempt" },
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_superseded_attempt, completedAt=<Instant>)",
      ]
    `);
  });

  test("refunds a payment for a reservation an operator force-cancelled", async () => {
    const { outcome, trace } = await recover({
      reservation: {
        ...expiredHeld,
        failureCode: administrationForcedPaymentCancellationFailureCode,
      },
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_after_administration_cancellation, completedAt=<Instant>)",
      ]
    `);
  });
});

describe("LatePaymentRecoveryService.recover original hold reuse", () => {
  test("reuses a current NEW hold", async () => {
    const { outcome, trace } = await recover({ reservation: currentHeld });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.completeUsingOriginalReservation(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, reservationState=held, completedAt=<Instant>)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("reuses a current hold Dotypos already confirmed", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      originalStatus: "CONFIRMED",
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.completeUsingOriginalReservation(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, reservationState=confirmed, completedAt=<Instant>)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("recreates a current hold Dotypos already cancelled", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      originalStatus: "CANCELLED",
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("releases a reused hold and refunds when its discount is gone", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      completeUsingOriginalReservation: fail(discountClaimError),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.completeUsingOriginalReservation(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, reservationState=held, completedAt=<Instant>)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_discount_unavailable, completedAt=<Instant>)",
      ]
    `);
  });

  test("requires review when a reused hold with a gone discount can't be released", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      findByIdSequence: [
        currentHeld,
        { ...currentHeld, reservationState: "confirmed" },
      ],
      completeUsingOriginalReservation: fail(discountClaimError),
    });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.completeUsingOriginalReservation(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, reservationState=held, completedAt=<Instant>)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call recoveries.requireReview(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_reservation_state_unexpected, completedAt=<Instant>)",
      ]
    `);
  });

  test("rechecks newer reservations and recreates when the hold stops being reusable", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      newerReservation: [false, true],
      completeUsingOriginalReservation: fail(
        new OriginalHoldNotReusableError({
          paymentAttemptId: "attempt-id" as never,
          message: "The hold reached its reuse margin.",
        })
      ),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.completeUsingOriginalReservation(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, reservationState=held, completedAt=<Instant>)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_newer_reservation, completedAt=<Instant>)",
      ]
    `);
  });

  test("keeps other reuse settlement failures retryable", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      completeUsingOriginalReservation: fail(recoveryStateError),
    });

    expect(outcome).toBe("fail: Late-payment recovery failed.");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.completeUsingOriginalReservation(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, reservationState=held, completedAt=<Instant>)",
      ]
    `);
  });

  test("skips reuse when a newer reservation exists", async () => {
    const { outcome, trace } = await recover({
      reservation: currentHeld,
      newerReservation: [true],
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_newer_reservation, completedAt=<Instant>)",
      ]
    `);
  });

  test("dies when the reservation disappears before release", async () => {
    const { outcome, trace } = await recover({
      findByIdSequence: [expiredHeld, null],
    });

    expect(outcome).toBe(
      "die: Late-payment recovery reservation disappeared before release."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  test("dies when the reservation disappears after release", async () => {
    const { outcome, trace } = await recover({
      reservation: { ...expiredHeld, reservationState: "cancelled" },
      findByIdSequence: [
        { ...expiredHeld, reservationState: "cancelled" },
        { ...expiredHeld, reservationState: "cancelled" },
        null,
      ],
    });

    expect(outcome).toBe(
      "die: Late-payment recovery reservation disappeared after release."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });
});

describe("LatePaymentRecoveryService.recover original hold release", () => {
  test("recreates an already released reservation without touching Dotypos", async () => {
    const { outcome, trace } = await recover({
      reservation: { ...expiredHeld, reservationState: "cancelled" },
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("requires review for a reservation in an unexpected state", async () => {
    const { outcome, trace } = await recover({
      reservation: { ...expiredHeld, reservationState: "confirmed" },
    });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call recoveries.requireReview(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_reservation_state_unexpected, completedAt=<Instant>)",
      ]
    `);
  });

  test("waits for a fresh hold cancellation another workflow owns", async () => {
    const { outcome, trace } = await recover({
      reservation: {
        ...expiredHeld,
        reservationState: "cancelling",
        updatedAt: Temporal.Now.instant(),
      },
    });

    expect(outcome).toBe(
      "fail: Late-payment recovery is waiting for hold cancellation."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
      ]
    `);
  });

  test("finishes a stale hold cancellation without claiming it again", async () => {
    const { outcome, trace } = await recover({
      reservation: { ...expiredHeld, reservationState: "cancelling" },
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("requires review when Dotypos confirmed the original hold", async () => {
    const { outcome, trace } = await recover({ originalStatus: "CONFIRMED" });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.requireReview(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_original_confirmed, completedAt=<Instant>)",
      ]
    `);
  });

  test("requires review when the original hold's cancellation is uncertain", async () => {
    const { outcome, trace } = await recover({ originalStatus: "COMPLETED" });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call recoveries.requireReview(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_original_cancellation_uncertain, completedAt=<Instant>)",
      ]
    `);
  });

  test("retries when the original hold's cancellation can't be claimed", async () => {
    const { outcome, trace } = await recover({ claimCancellation: false });

    expect(outcome).toBe(
      "fail: Late-payment recovery could not claim the original hold cancellation."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
      ]
    `);
  });

  test("records a cancellation Dotypos already made without cancelling again", async () => {
    const { outcome, trace } = await recover({
      reservation: { ...expiredHeld, reservationState: "cancellation_failed" },
      originalStatus: "CANCELLED",
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("marks the cancellation failed and retries when Dotypos can't cancel the hold", async () => {
    const { outcome, trace } = await recover({
      cancelReservation: fail(
        new DotyposUnavailable({
          operation: "cancelReservation",
          reason: "timeout",
        })
      ),
    });

    expect(outcome).toBe("fail: Late-payment recovery failed.");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancellationFailed(id=reservation-id, failureCode=dotypos_cancel_failed)",
      ]
    `);
  });

  test("accepts a cancellation a concurrent cleanup finished", async () => {
    const { outcome, trace } = await recover({
      markCancelled: (row) => () =>
        Effect.suspend(() => {
          row.current = { ...row.current, reservationState: "cancelled" };
          return Effect.fail(reservationStateError);
        }),
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("keeps the cancelled marker failure when no cleanup finished the cancellation", async () => {
    const { outcome, trace } = await recover({
      markCancelled: () => fail(reservationStateError),
    });

    expect(outcome).toBe("fail: Late-payment recovery failed.");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });
});

describe("LatePaymentRecoveryService.recover reservation recreation", () => {
  test("recreates a cowork reservation from its snapshot", async () => {
    const { outcome, trace, calls } = await recover({});

    expect(outcome).toBe("recovered");
    expect(calls.ensureAvailable.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "date": "2099-01-01",
            "entryTier": "basic",
            "kind": "cowork",
            "monitorOption": undefined,
          },
        ],
      ]
    `);
    expect(calls.createReservation.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "customerId": "dotypos-customer-id",
            "endDate": 2099-01-01T23:00:00.000Z,
            "note": 
      "Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340"
      ,
            "seats": 1,
            "startDate": 2098-12-31T23:00:00.000Z,
            "status": "CONFIRMED",
            "tableId": "table-id",
          },
        ],
      ]
    `);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("recreates an early-setup meeting room from its snapshot", async () => {
    const { outcome, calls } = await recover({
      reservation: {
        ...expiredHeld,
        reservationDetails: {
          kind: "meeting-room",
          duration: { unit: "hour", amount: 4 },
          earlySetup: true,
        },
      },
      snapshot: makeMeetingRoomInvoiceDocument("cs-CZ"),
    });

    expect(outcome).toBe("recovered");
    expect(calls.ensureAvailable.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "endsAt": "2099-02-03T12:00:00Z",
            "kind": "meeting-room",
            "startsAt": "2099-02-03T07:45:00Z",
          },
        ],
      ]
    `);
    expect(calls.createReservation.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "customerId": "dotypos-customer-id",
            "endDate": 2099-02-03T12:00:00.000Z,
            "note": 
      "Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Zasedací místnost
      Date: 2099-02-03
      Time: 2099-02-03T08:00:00Z-2099-02-03T12:00:00Z
      Duration: 4 hodiny
      Setup from: 08:45
      Price: 980 Kč"
      ,
            "seats": 1,
            "startDate": 2099-02-03T07:45:00.000Z,
            "status": "CONFIRMED",
            "tableId": "table-id",
          },
        ],
      ]
    `);
  });

  test("recreates an office reservation from its snapshot", async () => {
    const { outcome, calls } = await recover({
      reservation: {
        ...expiredHeld,
        reservationDetails: makeOfficeInvoiceDocument("en-US").reservation,
      },
      snapshot: makeOfficeInvoiceDocument("en-US"),
    });

    expect(outcome).toBe("recovered");
    expect(calls.ensureAvailable.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "endsAt": "2099-06-21T22:00:00Z",
            "kind": "office",
            "seats": 3,
            "startsAt": "2099-06-19T22:00:00Z",
          },
        ],
      ]
    `);
    expect(calls.createReservation.mock.calls).toMatchInlineSnapshot(`
      [
        [
          {
            "customerId": "dotypos-customer-id",
            "endDate": 2099-06-21T22:00:00.000Z,
            "note": 
      "Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Private office
      Dates: 2099-06-20-2099-06-21
      Seats: 3
      Price: CZK 2,950"
      ,
            "seats": 3,
            "startDate": 2099-06-19T22:00:00.000Z,
            "status": "CONFIRMED",
            "tableId": "table-id",
          },
        ],
      ]
    `);
  });

  test("refunds when the snapshot is unavailable", async () => {
    const { outcome, trace } = await recover({ snapshot: null });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_snapshot_unavailable, completedAt=<Instant>)",
      ]
    `);
  });

  test("refunds a newer reservation when the snapshot is unavailable", async () => {
    const { outcome, trace } = await recover({
      snapshot: null,
      newerReservation: [true],
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_newer_reservation, completedAt=<Instant>)",
      ]
    `);
  });

  test("refunds when the snapshot describes another kind of reservation", async () => {
    const { outcome, trace } = await recover({
      snapshot: makeMeetingRoomInvoiceDocument("en-US"),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_snapshot_unavailable, completedAt=<Instant>)",
      ]
    `);
  });

  test("refunds a reservation that already ended", async () => {
    const document = makeCoworkInvoiceDocument("en-US");
    const { outcome, trace } = await recover({
      snapshot: {
        ...document,
        reservation: { ...document.reservation, date: "2020-01-01" },
      } as never,
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_reservation_ended, completedAt=<Instant>)",
      ]
    `);
  });

  test("requires review when several replacements carry the recovery marker", async () => {
    const replacement = {
      status: "CONFIRMED",
      note: "Booked online\nPayment order: reservation-id",
    };
    const { outcome, trace } = await recover({
      overlapping: [
        { ...replacement, id: "replacement-a" },
        { id: "unrelated", status: "NEW", note: null },
        { ...replacement, id: "replacement-b" },
      ],
    });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call recoveries.requireReview(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_replacement_ambiguous, completedAt=<Instant>)",
      ]
    `);
  });

  test("cancels an orphaned replacement and refunds a newer reservation", async () => {
    const { outcome, trace } = await recover({
      newerReservation: [true],
      overlapping: [
        {
          id: "replacement-id",
          status: "NEW",
          note: "Payment order: reservation-id",
        },
      ],
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call dotypos.cancelReservation(replacement-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_newer_reservation, completedAt=<Instant>)",
      ]
    `);
  });

  test("resumes a held replacement an interrupted run created", async () => {
    const { outcome, trace } = await recover({
      overlapping: [
        {
          id: "replacement-id",
          status: "NEW",
          note: "Payment order: reservation-id",
        },
      ],
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=held, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("resumes a confirmed replacement an interrupted run created", async () => {
    const { outcome, trace } = await recover({
      overlapping: [
        {
          id: "replacement-id",
          status: "CONFIRMED",
          note: "Payment order: reservation-id",
        },
      ],
    });

    expect(outcome).toBe("recovered");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call fulfillment.run(reservation-id)",
      ]
    `);
  });

  test("refunds when the slot is no longer available", async () => {
    const { outcome, trace } = await recover({
      ensureAvailable: fail(
        new WorkspaceTableUnavailableError({
          date: "2099-01-01",
          reservation: { kind: "cowork", entryTier: "basic" },
        })
      ),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_reservation_unavailable, completedAt=<Instant>)",
      ]
    `);
  });

  test("refunds when no table can be assigned", async () => {
    const { outcome, trace } = await recover({
      assignTableId: fail(
        new TableAssignmentUnavailableError({
          requiredTags: ["tier:basic"],
          message: "No available Dotypos workspace table matches tags",
        })
      ),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Error Workspace Dotypos reservation creation failed (cause=<TableAssignmentUnavailableError>) {date,entryTier,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_reservation_unavailable, completedAt=<Instant>)",
      ]
    `);
  });

  test("requires review when the created replacement has no ID", async () => {
    const { outcome, trace } = await recover({ createdId: "" });

    expect(outcome).toBe("review_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.requireReview(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_replacement_id_missing, completedAt=<Instant>)",
      ]
    `);
  });

  test("cancels the replacement and refunds when a newer reservation wins at settlement", async () => {
    const { outcome, trace } = await recover({
      newerReservation: [false, true],
      completeWithReplacement: fail(recoveryStateError),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "call dotypos.cancelReservation(replacement-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_newer_reservation, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });

  test("keeps a settlement conflict without a newer reservation retryable", async () => {
    const { outcome, trace } = await recover({
      completeWithReplacement: fail(recoveryStateError),
    });

    expect(outcome).toBe("fail: Late-payment recovery failed.");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
      ]
    `);
  });

  test("cancels the replacement and refunds when the discount is gone at settlement", async () => {
    const { outcome, trace } = await recover({
      completeWithReplacement: fail(discountClaimError),
    });

    expect(outcome).toBe("refund_required");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span latePaymentRecovery.recover",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
        "call recoveries.claim(paymentAttemptId=attempt-id, staleProcessingBefore=<Instant>)",
        "call reservations.findById(reservation-id)",
        "call recoveries.hasNewerActiveReservation(reservation-id)",
        "span latePaymentRecovery.releaseCurrentHold",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.releaseOriginalHold",
        "call dotypos.getReservationStatus(dotypos-reservation-id)",
        "call reservations.claimCancellation(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>)",
        "call reservations.findById(reservation-id)",
        "span latePaymentRecovery.recreateReservation",
        "call snapshots.findByPaymentAttemptId(attempt-id)",
        "span normalizeReservationIntervalFields",
        "call dotypos.listActiveReservationsOverlapping(startDate=<Date>, endDate=<Date>)",
        "call availability.ensureAvailable(kind=cowork, date=2099-01-01, entryTier=basic, monitorOption=undefined)",
        "span createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation input received {date,entryTier,input,locale,paymentOrderId,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "span normalizeReservationIntervalFields",
        "call tableAssignments.assignTableId(kind=cowork, entryTier=basic, coffee=true, date=2099-01-01)",
        "Info Workspace Dotypos reservation input built {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "Info Workspace Dotypos reservation creation started {date,entryTier,input,locale,paymentOrderId,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        
      "call dotypos.createReservation(customerId=dotypos-customer-id, startDate=<Date>, endDate=<Date>, seats=1, tableId=table-id, status=CONFIRMED, note=Deskohub workspace post-payment reservation
      Payment order: reservation-id
      Product: Basic Day Pass
      Date: 2099-01-01
      Coffee: yes
      Price: CZK 340)"
      ,
        "Info Workspace Dotypos reservation creation completed {date,entryTier,input,locale,paymentOrderId,reservation,reservationInput,reservationKind,reservationStatus} in createWorkspaceDotyposReservation",
        "call recoveries.completeWithReplacement(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, recoveredDotyposReservationId=replacement-id, reservationState=confirmed, completedAt=<Instant>)",
        "call dotypos.cancelReservation(replacement-id)",
        "call recoveries.requireRefund(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, failureCode=late_payment_discount_unavailable, completedAt=<Instant>)",
        "call recoveries.findByPaymentAttemptId(attempt-id)",
      ]
    `);
  });
});
