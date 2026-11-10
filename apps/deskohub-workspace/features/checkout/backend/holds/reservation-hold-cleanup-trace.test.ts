import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService, DotyposUnavailable } from "@deskohub/dotypos";
import { Cause, Effect, Exit, Layer, Predicate } from "effect";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";

mock.module("server-only", () => ({}));

const { ReservationHoldCleanupService } = await import(
  "./reservation-hold-cleanup.service"
);
const { UnpaidHoldRelease } = await import("./unpaid-hold-release.service");
const { ProviderPaymentDeferral, ProviderPaymentFinalizationService } =
  await import("../payment/provider-payment-finalization.service");
const { PaymentLifecycleRepository, PaymentLifecycleStateError } = await import(
  "../repositories/payment-lifecycle.repository"
);
const { WorkspaceReservationRepository, WorkspaceReservationStateError } =
  await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
const { CheckoutAnalytics } = await import(
  "../analytics/checkout-analytics.service"
);
const { silentCheckoutAnalytics } = await import(
  "../analytics/checkout-analytics.service.mock"
);

type Methods = Record<
  string,
  (...args: never[]) => Effect.Effect<unknown, unknown>
>;

interface Collaborators {
  readonly reservations?: Methods;
  readonly paymentLifecycle?: Methods;
  readonly finalization?: Methods;
  readonly dotypos?: Methods;
}

const orderId = "reservation-id";
const checkedAt = Temporal.Instant.from("2026-07-01T08:00:00.000Z");

const heldOrder = {
  id: orderId,
  reservationState: "held",
  paymentState: "pending",
  activePaymentAttemptId: "payment-attempt-id",
  dotyposReservationId: "dotypos-reservation-id",
};

const cancellingOrder = { ...heldOrder, reservationState: "cancelling" };

const succeed =
  <A>(value: A) =>
  () =>
    Effect.succeed(value as never);
const fail =
  <E>(error: E) =>
  () =>
    Effect.fail(error as never);

const paymentLifecycleStateError = new PaymentLifecycleStateError({
  operation: "markTerminal",
  paymentReference: { paymentAttemptId: "payment-attempt-id" } as never,
  message: "The payment attempt is no longer pending.",
});

const reservationStateError = new WorkspaceReservationStateError({
  operation: "markCancelled",
  reservationId: orderId as never,
  message: "The reservation is no longer cancelling.",
});

/** Collaborators of a cleanup that claims and cancels the held order. */
const cancellingCollaborators = (
  overrides: Collaborators = {}
): Collaborators => ({
  ...overrides,
  reservations: {
    findById: succeed(heldOrder),
    claimCancellation: succeed(cancellingOrder),
    markCancelled: succeed(undefined),
    markCancellationFailed: succeed(undefined),
    recordHoldCleanupSkipped: succeed(undefined),
    ...overrides.reservations,
  },
  paymentLifecycle: {
    markTerminal: succeed({ changed: true }),
    ...overrides.paymentLifecycle,
  },
  finalization: {
    finalizePendingProviderPayment: succeed("terminal"),
    ...overrides.finalization,
  },
  dotypos: {
    cancelReservation: succeed(undefined),
    ...overrides.dotypos,
  },
});

const cancelOrderHold = async (
  collaborators: Collaborators,
  input: { readonly checkedAt?: Temporal.Instant } = { checkedAt }
) => {
  const trace: EffectTrace = startEffectTrace();
  const record = (service: string, methods: Methods | undefined) =>
    trace.recordCalls(service, methods ?? {});
  const exit = await Effect.gen(function* () {
    const cleanup = yield* ReservationHoldCleanupService;
    return yield* recordEffectTrace(
      trace,
      cleanup.cancelOrderHold({ orderId: orderId as never, ...input })
    );
  }).pipe(
    Effect.provide(
      ReservationHoldCleanupService.Default.pipe(
        Layer.provide(UnpaidHoldRelease.Default),
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              WorkspaceReservationRepository,
              record("reservations", collaborators.reservations)
            ),
            Layer.mock(
              PaymentLifecycleRepository,
              record("paymentLifecycle", collaborators.paymentLifecycle)
            ),
            Layer.mock(
              ProviderPaymentFinalizationService,
              record("finalization", collaborators.finalization)
            ),
            Layer.mock(
              DotyposService,
              record("dotypos", collaborators.dotypos)
            ),
            Layer.mock(
              CheckoutAnalytics,
              trace.recordCalls("checkoutAnalytics", silentCheckoutAnalytics)
            )
          )
        )
      )
    ),
    Effect.runPromise
  );
  return {
    outcome: outcomeOf(exit),
    failure: Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined,
    trace: trace.entries,
  };
};

/** The success value, or the failure's message. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  return Predicate.hasProperty(failure, "message") ? failure.message : failure;
};

const dotyposUnavailable = new DotyposUnavailable({
  operation: "cancelReservation",
  reason: "timeout",
});

describe("ReservationHoldCleanupService.cancelOrderHold trace", () => {
  test("fails when the order can't be loaded", async () => {
    const { outcome, trace } = await cancelOrderHold({
      reservations: { findById: fail(new Error("db down")) },
    });

    expect(outcome).toBe(
      "Reservation hold cancellation state could not be loaded."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  test("fails when provider finalization fails", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: {
          finalizePendingProviderPayment: fail(new Error("nexi down")),
        },
      })
    );

    expect(outcome).toBe(
      "Payment lifecycle finalization failed during hold cleanup."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
      ]
    `);
  });

  test("skips a hold whose provider payment finalized paid", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed("paid") },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Warn Reservation hold cancellation skipped: provider finalized paid {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
      ]
    `);
  });

  test("defers a hold whose empty provider order is inside the abandonment window", async () => {
    const deferral = new ProviderPaymentDeferral({
      abandonmentCutoff: Temporal.Instant.from("2026-07-01T08:30:00.000Z"),
    });
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed(deferral) },
      })
    );

    expect(outcome).toBe(deferral);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation deferred: empty provider order is inside abandonment window (abandonmentCutoff=<Instant>) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
      ]
    `);
  });

  test("expires an abandoned payment attempt, then cancels the hold", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed("abandoned") },
      })
    );

    expect(outcome).toBe("cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation expiring payment attempt (reason=abandoned) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call paymentLifecycle.markTerminal(id=payment-attempt-id, workspaceReservationId=reservation-id, state=expired, failureCode=payment_abandoned_after_provider_cutoff)",
        "Info Reservation hold cancellation expired payment attempt (reason=abandoned) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentAttemptExpirationChanged,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentAttemptExpirationChanged,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>, holdExpiredAt=<Instant>)",
        "Info Reservation hold marked cancelled {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentAttemptExpirationChanged,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call checkoutAnalytics.reservationAbandoned(reservation=<Object>, timestamp=<Instant>)",
      ]
    `);
  });

  test("records a skipped cleanup when the abandoned attempt changed state", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed("abandoned") },
        paymentLifecycle: { markTerminal: fail(paymentLifecycleStateError) },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation expiring payment attempt (reason=abandoned) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call paymentLifecycle.markTerminal(id=payment-attempt-id, workspaceReservationId=reservation-id, state=expired, failureCode=payment_abandoned_after_provider_cutoff)",
        "Warn Reservation hold cancellation payment attempt expiration failed (orderId=reservation-id, paymentAttemptId=payment-attempt-id, cause=<PaymentLifecycleStateError>) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Warn Reservation hold cancellation skipped: payment attempt state changed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.recordHoldCleanupSkipped(id=reservation-id, holdExpiredAt=<Instant>, failureCode=payment_outcome_unconfirmed_before_cleanup)",
      ]
    `);
  });

  test("fails when the abandoned attempt can't be expired", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed("abandoned") },
        paymentLifecycle: { markTerminal: fail(new Error("db down")) },
      })
    );

    expect(outcome).toBe(
      "Payment attempt expiration failed during hold cleanup."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation expiring payment attempt (reason=abandoned) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call paymentLifecycle.markTerminal(id=payment-attempt-id, workspaceReservationId=reservation-id, state=expired, failureCode=payment_abandoned_after_provider_cutoff)",
        "Warn Reservation hold cancellation payment attempt expiration failed (orderId=reservation-id, paymentAttemptId=payment-attempt-id, cause=<Error>) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
      ]
    `);
  });

  test("records a skipped sweep cleanup while the payment outcome is unconfirmed", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed("pending") },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Warn Reservation hold cancellation skipped: payment outcome unconfirmed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.recordHoldCleanupSkipped(id=reservation-id, holdExpiredAt=<Instant>, failureCode=payment_outcome_unconfirmed_before_cleanup)",
      ]
    `);
  });

  test("skips an unscheduled cleanup while the payment outcome is unconfirmed without recording it", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: {
          finalizePendingProviderPayment: succeed(
            "provider_verification_failed"
          ),
        },
      }),
      {}
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Warn Reservation hold cancellation skipped: payment outcome unconfirmed {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
      ]
    `);
  });

  test("fails when the skipped cleanup can't be recorded", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        finalization: { finalizePendingProviderPayment: succeed("not_found") },
        reservations: {
          recordHoldCleanupSkipped: fail(new Error("db down")),
        },
      })
    );

    expect(outcome).toBe(
      "Skipped reservation hold cleanup marker could not be stored."
    );
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Warn Reservation hold cancellation skipped: payment outcome unconfirmed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.recordHoldCleanupSkipped(id=reservation-id, holdExpiredAt=<Instant>, failureCode=payment_outcome_unconfirmed_before_cleanup)",
      ]
    `);
  });

  test("cancels an unscheduled hold whose attempt is already terminal", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators(),
      {}
    );

    expect(outcome).toBe("cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>, holdExpiredAt=undefined)",
        "Info Reservation hold marked cancelled {activePaymentAttemptId,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call checkoutAnalytics.reservationAbandoned(reservation=<Object>, timestamp=<Instant>)",
      ]
    `);
  });

  test("claims an order without a pending payment directly", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: {
          findById: succeed({ ...heldOrder, paymentState: "failed" }),
        },
      })
    );

    expect(outcome).toBe("cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in unpaidHoldRelease.release",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>, holdExpiredAt=<Instant>)",
        "Info Reservation hold marked cancelled {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call checkoutAnalytics.reservationAbandoned(reservation=<Object>, timestamp=<Instant>)",
      ]
    `);
  });

  test("fails when the cancellation can't be claimed", async () => {
    const dbDown = new Error("db down");
    const { failure, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: { claimCancellation: fail(dbDown) },
      })
    );

    expect(failure).toMatchObject({
      _tag: "ReservationHoldCleanupError",
      cause: dbDown,
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
      ]
    `);
  });

  test("resumes a cancellation another run already claimed", async () => {
    const findById = mock(succeed(heldOrder));
    findById.mockImplementationOnce(succeed(null));
    findById.mockImplementationOnce(succeed(cancellingOrder));
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: { findById, claimCancellation: succeed(null) },
      })
    );

    expect(outcome).toBe("cancelled");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=false) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in unpaidHoldRelease.release",
        "call reservations.findById(reservation-id)",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>, holdExpiredAt=<Instant>)",
        "Info Reservation hold marked cancelled {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call checkoutAnalytics.reservationAbandoned(reservation=<Object>, timestamp=<Instant>)",
      ]
    `);
  });

  test("skips a missing order", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: {
          findById: succeed(null),
          claimCancellation: succeed(null),
        },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=false) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in unpaidHoldRelease.release",
        "call reservations.findById(reservation-id)",
        "Warn Reservation hold cancellation skipped: claim not cancellable {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in unpaidHoldRelease.release",
      ]
    `);
  });

  test("fails when an already claimed cancellation can't be reloaded", async () => {
    const dbDown = new Error("db down");
    const findById = mock(fail(dbDown));
    findById.mockImplementationOnce(succeed(null));
    const { failure, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: { findById, claimCancellation: succeed(null) },
      })
    );

    expect(failure).toMatchObject({
      _tag: "ReservationHoldCleanupError",
      cause: dbDown,
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=false) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in unpaidHoldRelease.release",
        "call reservations.findById(reservation-id)",
      ]
    `);
  });

  test("skips a claim without a Dotypos reservation", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: {
          claimCancellation: succeed({
            ...cancellingOrder,
            dotyposReservationId: null,
          }),
        },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "Warn Reservation hold cancellation skipped: missing Dotypos reservation {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
      ]
    `);
  });

  test("skips a claim that was paid meanwhile", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: {
          claimCancellation: succeed({
            ...cancellingOrder,
            paymentState: "paid",
          }),
        },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "Warn Reservation hold cancellation skipped: reservation paid {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
      ]
    `);
  });

  test("marks the cancellation failed when Dotypos can't cancel the hold", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        dotypos: { cancelReservation: fail(dotyposUnavailable) },
      })
    );

    expect(outcome).toBe("Dotypos reservation hold could not be cancelled.");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancellationFailed(id=reservation-id, failureCode=dotypos_cancel_failed)",
        "Error Dotypos reservation hold cancellation failed (cause=<DotyposUnavailable>) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
      ]
    `);
  });

  test("skips the cancelled marker when the reservation state changed", async () => {
    const { outcome, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: { markCancelled: fail(reservationStateError) },
      })
    );

    expect(outcome).toBe("skipped");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>, holdExpiredAt=<Instant>)",
        "Warn Reservation hold cancellation marker skipped: reservation state changed (orderId=reservation-id) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
      ]
    `);
  });

  test("fails when the cancelled marker can't be stored", async () => {
    const dbDown = new Error("db down");
    const { failure, trace } = await cancelOrderHold(
      cancellingCollaborators({
        reservations: { markCancelled: fail(dbDown) },
      })
    );

    expect(failure).toMatchObject({
      _tag: "ReservationHoldCleanupError",
      cause: dbDown,
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation started {checkedAt,input,orderId} in reservationHoldCleanup.cancelOrderHold",
        "call reservations.findById(reservation-id)",
        "Debug Reservation hold cancellation active reservation loaded {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "Info Reservation hold cancellation provider finalization started {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "call finalization.finalizePendingProviderPayment(orderId=reservation-id, paymentAttemptId=payment-attempt-id, abandonmentCheckedAt=<Instant>)",
        "Info Reservation hold cancellation provider finalization completed {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in reservationHoldCleanup.cancelOrderHold",
        "span unpaidHoldRelease.release",
        "call reservations.claimCancellation(reservation-id)",
        "Debug Reservation hold cancellation claim completed (claimedFromNew=true) {activePaymentAttemptId,checkedAt,dotyposReservationId,fulfillmentState,input,orderId,paymentState,providerFinalizationResult,reservationId,reservationState} in unpaidHoldRelease.release",
        "span dotyposHoldRelease.release",
        "call dotypos.cancelReservation(dotypos-reservation-id)",
        "call reservations.markCancelled(id=reservation-id, cancelledAt=<Instant>, holdExpiredAt=<Instant>)",
      ]
    `);
  });
});
