import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  ExternalAPIError,
  NetworkError,
  NexiService,
  type PaymentVerificationResult,
} from "@deskohub/nexi";
import { Cause, Effect, Exit, Layer, Predicate } from "effect";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";

mock.module("server-only", () => ({}));

const { ProviderPaymentFinalizationService } = await import(
  "./provider-payment-finalization.service"
);
const { PaymentAttemptRepository } = await import(
  "../repositories/payment-attempt.repository"
);
const { PaymentLifecycleRepository, PaymentLifecycleStateError } = await import(
  "../repositories/payment-lifecycle.repository"
);
const { PaidFulfillmentQueueService, PaidFulfillmentQueueError } = await import(
  "../fulfillment/paid-fulfillment-queue.service"
);
const { ReservationFulfillment } = await import(
  "../fulfillment/reservation-fulfillment.service"
);
const { WorkspaceReservationRepository } = await import(
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
  readonly paymentAttempts?: Methods;
  readonly paymentLifecycle?: Methods;
  readonly nexi?: Methods;
  readonly paidFulfillmentQueue?: Methods;
  readonly fulfillment?: Methods;
}

interface FinalizationInput {
  readonly paymentAttemptId?: string;
  readonly webhookEventId?: string;
  readonly abandonmentCheckedAt?: Temporal.Instant;
  readonly verificationDeadline?: string;
}

const orderId = "reservation-id";
const attemptCreatedAt = Temporal.Instant.from("2026-06-01T10:00:00Z");
const insideWindow = attemptCreatedAt.add({ minutes: 29, seconds: 59 });
const afterCutoff = attemptCreatedAt.add({ minutes: 30 });

const succeed =
  <A>(value: A) =>
  () =>
    Effect.succeed(value as never);
const fail =
  <E>(error: E) =>
  () =>
    Effect.fail(error as never);

const pendingReservation = {
  id: orderId,
  correlationId: "correlation-id",
  paymentState: "pending",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-id",
};

const paidReservation = (fulfillmentState: string) => ({
  ...pendingReservation,
  paymentState: "paid",
  fulfillmentState,
});

const pendingAttempt = {
  id: "attempt-id",
  workspaceReservationId: orderId,
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "pending" as const,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: attemptCreatedAt,
  createdAt: attemptCreatedAt,
};

const unattachedAttempt = {
  ...pendingAttempt,
  state: "created" as const,
  securityToken: null,
  providerRedirectUrl: null,
  providerOrderCreatedAt: null,
};

const verification = (
  status: PaymentVerificationResult["status"],
  provider: Partial<PaymentVerificationResult["provider"]> = {},
  mismatches: PaymentVerificationResult["mismatches"] = []
): PaymentVerificationResult => ({
  status,
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
    amount: "35000",
    currency: "CZK",
    orderStatus: status === "failure" ? "DECLINED" : "EXECUTED",
    captureExecuted: status === "success",
    ...provider,
  },
  mismatches,
});

const emptyPendingProvider = {
  operationId: undefined,
  operationCount: 0,
  authorizedAmount: "0",
  capturedAmount: "0.00",
  orderStatus: "PENDING",
  captureExecuted: false,
};

const lifecycleTransition = (changed: boolean, state: string) => ({
  attempt: { ...pendingAttempt, state },
  changed,
  timestamp: afterCutoff,
});

const lifecycleStateError = new PaymentLifecycleStateError({
  operation: "markPaid",
  paymentReference: { type: "paymentAttemptId", id: "attempt-id" } as never,
  message: "The payment attempt is no longer pending.",
});

/** Collaborators of a finalization that reaches Nexi verification. */
const verifyingCollaborators = (
  overrides: Collaborators = {}
): Collaborators => ({
  ...overrides,
  reservations: {
    findById: succeed(pendingReservation),
    ...overrides.reservations,
  },
  paymentAttempts: {
    findById: succeed(pendingAttempt),
    ...overrides.paymentAttempts,
  },
  paymentLifecycle: {
    markPaid: succeed(lifecycleTransition(true, "paid")),
    markTerminal: succeed(lifecycleTransition(true, "failed")),
    ...overrides.paymentLifecycle,
  },
  nexi: {
    verifyPaymentOutcome: succeed(verification("success")),
    ...overrides.nexi,
  },
  paidFulfillmentQueue: {
    enqueue: succeed(undefined),
    ...overrides.paidFulfillmentQueue,
  },
  fulfillment: { run: succeed(undefined), ...overrides.fulfillment },
});

/** Collaborators of a finalization whose attempt never attached a session. */
const unattachedCollaborators = (overrides: Collaborators = {}) =>
  verifyingCollaborators({
    ...overrides,
    paymentAttempts: { findById: succeed(unattachedAttempt) },
    nexi: {
      getOrder: succeed({ orderId: "provider-order-id", operations: [] }),
      ...overrides.nexi,
    },
  });

const finalize = async (
  collaborators: Collaborators,
  input: FinalizationInput = { paymentAttemptId: "attempt-id" }
) => {
  const trace: EffectTrace = startEffectTrace();
  const record = (service: string, methods: Methods | undefined) =>
    trace.recordCalls(service, methods ?? {});
  const exit = await Effect.gen(function* () {
    const finalization = yield* ProviderPaymentFinalizationService;
    return yield* recordEffectTrace(
      trace,
      finalization.finalizePendingProviderPayment({
        orderId: orderId as never,
        ...input,
      } as never)
    );
  }).pipe(
    Effect.provide(
      ProviderPaymentFinalizationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              WorkspaceReservationRepository,
              record("reservations", collaborators.reservations)
            ),
            Layer.mock(
              PaymentAttemptRepository,
              record("paymentAttempts", collaborators.paymentAttempts)
            ),
            Layer.mock(
              PaymentLifecycleRepository,
              record("paymentLifecycle", collaborators.paymentLifecycle)
            ),
            Layer.mock(NexiService, record("nexi", collaborators.nexi)),
            Layer.mock(
              PaidFulfillmentQueueService,
              record("paidFulfillmentQueue", collaborators.paidFulfillmentQueue)
            ),
            Layer.mock(
              ReservationFulfillment,
              record("fulfillment", collaborators.fulfillment)
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
  return { outcome: outcomeOf(exit), trace: trace.entries };
};

/** The success value, or the failure's tag. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  return Predicate.hasProperty(failure, "_tag") ? failure._tag : failure;
};

const queueDown = new PaidFulfillmentQueueError({ message: "queue down" });

describe("ProviderPaymentFinalizationService.finalizePendingProviderPayment trace", () => {
  test("returns not_found when the reservation can't be loaded", async () => {
    const { outcome, trace } = await finalize({
      reservations: { findById: fail(new Error("db down")) },
    });

    expect(outcome).toBe("not_found");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Error Payment finalization reservation lookup failed (orderId=reservation-id, cause=<Error>) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned not_found {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_found) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_found for a missing reservation", async () => {
    const { outcome, trace } = await finalize({
      reservations: { findById: succeed(null) },
    });

    expect(outcome).toBe("not_found");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned not_found {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_found) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_found without an input or active payment attempt", async () => {
    const { outcome, trace } = await finalize(
      {
        reservations: {
          findById: succeed({
            ...pendingReservation,
            activePaymentAttemptId: null,
          }),
        },
      },
      {}
    );

    expect(outcome).toBe("not_found");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned not_found {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_found) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("uses the reservation's active attempt without an input attempt", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: { verifyPaymentOutcome: fail(new Error("nexi down")) },
      }),
      {}
    );

    expect(outcome).toBe("provider_verification_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Error Nexi payment outcome verification failed (orderId=reservation-id, paymentAttemptId=attempt-id, providerOrderId=provider-order-id, cause=<Error>) {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned provider_verification_failed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=provider_verification_failed) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("enqueues fulfillment for an already-paid not_started reservation", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: { findById: succeed(paidReservation("not_started")) },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization enqueueing fulfillment for already-paid reservation {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Info Payment finalization fulfillment enqueued {input,paymentAttemptId,reservation} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("enqueues fulfillment for an already-paid processing reservation", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: { findById: succeed(paidReservation("processing")) },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization enqueueing fulfillment for already-paid reservation {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Info Payment finalization fulfillment enqueued {input,paymentAttemptId,reservation} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("fulfills inline when the queue is unavailable", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: { findById: succeed(paidReservation("not_started")) },
        paidFulfillmentQueue: { enqueue: fail(queueDown) },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization enqueueing fulfillment for already-paid reservation {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Error Paid order fulfillment could not be enqueued; fulfilling inline (orderId=reservation-id, cause=<PaidFulfillmentQueueError>) {input,paymentAttemptId,reservation} in providerPaymentFinalization.enqueueFulfillment",
        "call fulfillment.run(reservation-id)",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("ignores an inline fulfillment failure after the queue is unavailable", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: { findById: succeed(paidReservation("not_started")) },
        paidFulfillmentQueue: { enqueue: fail(queueDown) },
        fulfillment: { run: fail(new Error("dotypos down")) },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization enqueueing fulfillment for already-paid reservation {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Error Paid order fulfillment could not be enqueued; fulfilling inline (orderId=reservation-id, cause=<PaidFulfillmentQueueError>) {input,paymentAttemptId,reservation} in providerPaymentFinalization.enqueueFulfillment",
        "call fulfillment.run(reservation-id)",
        "Fatal Paid order fulfillment failed during finalization (orderId=reservation-id, cause=<Error>) {input,paymentAttemptId,reservation} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns paid for an already-paid awaiting_delivery reservation", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: {
          findById: succeed(paidReservation("awaiting_delivery")),
        },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned paid for fulfilled reservation {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns paid for an already-paid fulfilled reservation", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: { findById: succeed(paidReservation("fulfilled")) },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned paid for fulfilled reservation {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_pending for a paid reservation whose fulfillment failed", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: { findById: succeed(paidReservation("failed")) },
      })
    );

    expect(outcome).toBe("not_pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned not_pending {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_pending for a reservation whose payment ended", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        reservations: {
          findById: succeed({ ...pendingReservation, paymentState: "failed" }),
        },
      })
    );

    expect(outcome).toBe("not_pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned not_pending {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_verifiable when the attempt can't be loaded", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentAttempts: { findById: fail(new Error("db down")) },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Error Payment finalization attempt lookup failed (orderId=reservation-id, paymentAttemptId=attempt-id, cause=<Error>) {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned not_verifiable {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_verifiable for a missing attempt", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({ paymentAttempts: { findById: succeed(null) } })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned not_verifiable {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_verifiable for an attempt without a provider order", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentAttempts: {
          findById: succeed({ ...pendingAttempt, providerOrderId: null }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned not_verifiable {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_verifiable for a pending attempt without a security token", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentAttempts: {
          findById: succeed({ ...pendingAttempt, securityToken: null }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned not_verifiable {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_verifiable when the attempt currency doesn't decode", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentAttempts: {
          findById: succeed({
            ...pendingAttempt,
            amount: { ...pendingAttempt.amount, currency: "XXX" },
          }),
        },
      })
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Error Payment finalization currency decode failed (input=<Object>, reservation=<Object>, attempt=<Object>, cause=<SchemaError>) {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned not_verifiable {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns provider_verification_failed when Nexi verification fails", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: fail(
            new NetworkError({ message: "Failed to connect to Nexi" })
          ),
        },
      }),
      {
        paymentAttemptId: "attempt-id",
        verificationDeadline: "15 seconds",
      }
    );

    expect(outcome).toBe("provider_verification_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=15 seconds)",
        "Error Nexi payment outcome verification failed (orderId=reservation-id, paymentAttemptId=attempt-id, providerOrderId=provider-order-id, cause=<NetworkError>) {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned provider_verification_failed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=provider_verification_failed) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns verification_mismatch when the provider facts disagree", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("success", {}, ["amount", "securityToken"])
          ),
        },
      })
    );

    expect(outcome).toBe("verification_mismatch");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Warn Payment finalization returned verification_mismatch {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=verification_mismatch) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("marks a verified created attempt with a security token paid", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentAttempts: {
          findById: succeed({ ...pendingAttempt, state: "created" }),
        },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark paid started {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Debug Payment finalization mark paid completed {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Info Payment finalization fulfillment enqueued {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("marks a successful payment paid, captures it and enqueues fulfillment", async () => {
    const { outcome, trace } = await finalize(verifyingCollaborators(), {
      paymentAttemptId: "attempt-id",
      webhookEventId: "webhook-event-id",
      verificationDeadline: "15 seconds",
    });

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=15 seconds)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark paid started {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=webhook-event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Debug Payment finalization mark paid completed {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Info Payment finalization fulfillment enqueued {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("derives the provider status of a successful payment without an order status", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("success", { orderStatus: undefined })
          ),
        },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark paid started {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=capture_executed, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Debug Payment finalization mark paid completed {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Info Payment finalization fulfillment enqueued {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("skips the completed capture when the attempt was already paid", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentLifecycle: {
          markPaid: succeed(lifecycleTransition(false, "paid")),
        },
      })
    );

    expect(outcome).toBe("paid");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark paid started {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "Debug Payment finalization mark paid completed {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.enqueueFulfillment",
        "call paidFulfillmentQueue.enqueue(orderId=reservation-id)",
        "Info Payment finalization fulfillment enqueued {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.enqueueFulfillment",
        "Info Provider payment finalization completed (result=paid) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_pending when the attempt changed before it could be marked paid", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentLifecycle: { markPaid: fail(lifecycleStateError) },
      })
    );

    expect(outcome).toBe("not_pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark paid started {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "Warn Payment finalization mark paid returned not_pending (cause=<PaymentLifecycleStateError>) {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("fails when marking paid fails to persist", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        paymentLifecycle: { markPaid: fail(new Error("db down")) },
      })
    );

    expect(outcome).toBeInstanceOf(Error);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark paid started {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
      ]
    `);
  });

  test("marks a declined payment failed and captures the failure", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: { verifyPaymentOutcome: succeed(verification("failure")) },
      }),
      { paymentAttemptId: "attempt-id", webhookEventId: "webhook-event-id" }
    );

    expect(outcome).toBe("terminal");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark terminal started {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=webhook-event-id, providerOperationId=operation-id, providerStatus=DECLINED)",
        "call checkoutAnalytics.paymentFailed(attempt=<Object>, failureReason=nexi_payment_failed, timestamp=<Instant>)",
        "Debug Payment finalization mark terminal completed {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=terminal) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("marks a cancelled payment cancelled and captures the abandonment", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("failure", { orderStatus: "CANCELED" })
          ),
        },
        paymentLifecycle: {
          markTerminal: succeed(lifecycleTransition(true, "cancelled")),
        },
      })
    );

    expect(outcome).toBe("terminal");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark terminal started {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=cancelled, failureCode=nexi_payment_failed, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=CANCELED)",
        "call checkoutAnalytics.paymentAbandoned(attempt=<Object>, timestamp=<Instant>)",
        "Debug Payment finalization mark terminal completed {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=terminal) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("marks an expired payment expired and captures the abandonment", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("failure", { orderStatus: "EXPIRED" })
          ),
        },
        paymentLifecycle: {
          markTerminal: succeed(lifecycleTransition(true, "expired")),
        },
      })
    );

    expect(outcome).toBe("terminal");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark terminal started {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=expired, failureCode=nexi_payment_failed, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=EXPIRED)",
        "call checkoutAnalytics.paymentAbandoned(attempt=<Object>, timestamp=<Instant>)",
        "Debug Payment finalization mark terminal completed {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=terminal) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("skips the terminal capture when the attempt was already terminal", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: { verifyPaymentOutcome: succeed(verification("failure")) },
        paymentLifecycle: {
          markTerminal: succeed(lifecycleTransition(false, "failed")),
        },
      })
    );

    expect(outcome).toBe("terminal");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark terminal started {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=DECLINED)",
        "Debug Payment finalization mark terminal completed {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=terminal) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns not_pending when the attempt changed before it could be marked terminal", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: { verifyPaymentOutcome: succeed(verification("failure")) },
        paymentLifecycle: { markTerminal: fail(lifecycleStateError) },
      })
    );

    expect(outcome).toBe("not_pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark terminal started {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=DECLINED)",
        "Warn Payment finalization mark terminal returned not_pending (cause=<PaymentLifecycleStateError>) {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=not_pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("fails when marking terminal fails to persist", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: { verifyPaymentOutcome: succeed(verification("failure")) },
        paymentLifecycle: { markTerminal: fail(new Error("db down")) },
      })
    );

    expect(outcome).toBeInstanceOf(Error);
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization mark terminal started {attempt,currency,failureKind,input,paymentAttemptId,providerMetadata,reservation,terminalState,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=undefined, providerOperationId=operation-id, providerStatus=DECLINED)",
      ]
    `);
  });

  test("returns pending for a pending provider order with payment activity", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: { verifyPaymentOutcome: succeed(verification("pending")) },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned pending {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns pending for an empty provider order outside hold cleanup", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("pending", emptyPendingProvider)
          ),
        },
      })
    );

    expect(outcome).toBe("pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization returned pending {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("defers an empty provider order inside the abandonment window", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("pending", emptyPendingProvider)
          ),
        },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: insideWindow }
    );

    expect(outcome).toEqual({
      _tag: "ProviderPaymentDeferral",
      abandonmentCutoff: afterCutoff,
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization resolved empty provider order (result=deferred) {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=<ProviderPaymentDeferral>) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("returns abandoned for an empty provider order past the abandonment window", async () => {
    const { outcome, trace } = await finalize(
      verifyingCollaborators({
        nexi: {
          verifyPaymentOutcome: succeed(
            verification("pending", emptyPendingProvider)
          ),
        },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("abandoned");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization currency decoded {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization provider verification started {attempt,currency,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token, deadline=undefined)",
        "Info Payment finalization provider verification completed {attempt,currency,input,paymentAttemptId,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Debug Payment finalization provider metadata resolved {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Payment finalization resolved empty provider order (result=abandoned) {attempt,currency,input,paymentAttemptId,providerMetadata,reservation,verification} in providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization completed (result=abandoned) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });
});

describe("ProviderPaymentFinalizationService unattached provider session trace", () => {
  test("leaves an unattached session for hold cleanup outside it", async () => {
    const { outcome, trace } = await finalize(unattachedCollaborators());

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "Warn Payment finalization left an unattached provider session for hold cleanup {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("defers an unattached session inside the abandonment window", async () => {
    const { outcome, trace } = await finalize(unattachedCollaborators(), {
      paymentAttemptId: "attempt-id",
      abandonmentCheckedAt: insideWindow,
    });

    expect(outcome).toEqual({
      _tag: "ProviderPaymentDeferral",
      abandonmentCutoff: afterCutoff,
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Payment finalization deferred an unattached provider session {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=<ProviderPaymentDeferral>) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("fails an unattached session whose provider order was never created", async () => {
    const { outcome, trace } = await finalize(
      unattachedCollaborators({
        nexi: {
          getOrder: fail(
            new ExternalAPIError({
              service: "Nexi",
              operation: "Get order",
              statusCode: 404,
            })
          ),
        },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("terminal");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "call nexi.getOrder(orderId=provider-order-id, correlationId=correlation-id)",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_hpp_create_unconfirmed, providerStatus=hpp_create_unconfirmed, fromAttemptStates=<Array>)",
        "call checkoutAnalytics.paymentFailed(attempt=<Object>, failureReason=nexi_hpp_create_unconfirmed, timestamp=<Instant>)",
        "Info Payment finalization failed an unattached provider session (providerOrderFound=false) {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=terminal) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("fails an unattached session whose empty provider order already failed", async () => {
    const { outcome, trace } = await finalize(
      unattachedCollaborators({
        paymentLifecycle: {
          markTerminal: succeed(lifecycleTransition(false, "failed")),
        },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("terminal");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "call nexi.getOrder(orderId=provider-order-id, correlationId=correlation-id)",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_hpp_create_unconfirmed, providerStatus=hpp_create_unconfirmed, fromAttemptStates=<Array>)",
        "Info Payment finalization failed an unattached provider session (providerOrderFound=true) {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=terminal) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("keeps an unattached session whose provider order has payment activity", async () => {
    const { outcome, trace } = await finalize(
      unattachedCollaborators({
        nexi: {
          getOrder: succeed({
            orderId: "provider-order-id",
            operations: [{ operationType: "AUTHORIZATION" }],
          }),
        },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("not_verifiable");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "call nexi.getOrder(orderId=provider-order-id, correlationId=correlation-id)",
        "Error Unattached provider session has payment activity and needs operator review {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=not_verifiable) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("keeps an unattached session when the provider order lookup fails", async () => {
    const { outcome, trace } = await finalize(
      unattachedCollaborators({
        nexi: {
          getOrder: fail(
            new ExternalAPIError({
              service: "Nexi",
              operation: "Get order",
              statusCode: 500,
            })
          ),
        },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("provider_verification_failed");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "call nexi.getOrder(orderId=provider-order-id, correlationId=correlation-id)",
        "Error Unattached provider session order lookup failed (cause=<ExternalAPIError>) {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=provider_verification_failed) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });

  test("yields to a provider session attached concurrently", async () => {
    const { outcome, trace } = await finalize(
      unattachedCollaborators({
        paymentLifecycle: { markTerminal: fail(lifecycleStateError) },
      }),
      { paymentAttemptId: "attempt-id", abandonmentCheckedAt: afterCutoff }
    );

    expect(outcome).toBe("not_pending");
    expect(trace).toMatchInlineSnapshot(`
      [
        "span providerPaymentFinalization.finalizePendingProviderPayment",
        "Info Provider payment finalization started {input} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call reservations.findById(reservation-id)",
        "Debug Payment finalization reservation lookup completed {input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "call paymentAttempts.findById(attempt-id)",
        "Debug Payment finalization attempt lookup completed {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.finalizePendingProviderPayment",
        "span providerPaymentFinalization.resolveUnattachedProviderSession",
        "call nexi.getOrder(orderId=provider-order-id, correlationId=correlation-id)",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_hpp_create_unconfirmed, providerStatus=hpp_create_unconfirmed, fromAttemptStates=<Array>)",
        "Warn Unattached provider session changed before it could fail (cause=<PaymentLifecycleStateError>) {attempt,input,paymentAttemptId,reservation} in providerPaymentFinalization.resolveUnattachedProviderSession",
        "Info Provider payment finalization completed (result=not_pending) {input} in providerPaymentFinalization.finalizePendingProviderPayment",
      ]
    `);
  });
});
