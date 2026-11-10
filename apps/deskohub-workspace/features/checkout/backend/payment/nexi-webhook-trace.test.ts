import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { NexiService, type PaymentVerificationResult } from "@deskohub/nexi";
import { Cause, Effect, Exit, Layer, Predicate } from "effect";
import {
  type EffectTrace,
  recordEffectTrace,
  startEffectTrace,
} from "@/shared/testing/effect-trace.test-utils";

mock.module("server-only", () => ({}));

const { NexiWebhookService } = await import("./nexi-webhook.service");
const { WorkspaceReservationRepository } = await import(
  "@/features/reservation/backend/workspace-reservation.repository"
);
const { CheckoutAnalytics } = await import(
  "../analytics/checkout-analytics.service"
);
const { silentCheckoutAnalytics } = await import(
  "../analytics/checkout-analytics.service.mock"
);
const { ReservationFulfillment } = await import(
  "../fulfillment/reservation-fulfillment.service"
);
const { LatePaymentRecoveryRepository } = await import(
  "../repositories/late-payment-recovery.repository"
);
const { PaymentAttemptRepository } = await import(
  "../repositories/payment-attempt.repository"
);
const { PaymentLifecycleRepository, PaymentLifecycleStateError } = await import(
  "../repositories/payment-lifecycle.repository"
);
const { WebhookEventRepository } = await import(
  "../repositories/webhook-event.repository"
);
const { LatePaymentRecoveryQueueService } = await import(
  "./late-payment-recovery-queue.service"
);
const { PaymentRefundService } = await import("./payment-refund.service");

type Methods = Record<
  string,
  (...args: never[]) => Effect.Effect<unknown, unknown>
>;

interface Collaborators {
  readonly webhookEvents?: Methods;
  readonly paymentAttempts?: Methods;
  readonly paymentLifecycle?: Methods;
  readonly reservations?: Methods;
  readonly nexi?: Methods;
  readonly fulfillment?: Methods;
  readonly latePaymentRecoveries?: Methods;
  readonly latePaymentRecoveryQueue?: Methods;
  readonly paymentRefunds?: Methods;
}

const payload = {
  eventId: "event-id",
  securityToken: "security-token",
  operation: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationType: "CAPTURE",
    operationResult: "EXECUTED",
    operationAmount: "35000",
    operationCurrency: "CZK",
  },
};

interface Notification {
  readonly eventId?: string;
  readonly securityToken?: string;
  readonly operation: Partial<typeof payload.operation>;
}

const refundPayload = {
  ...payload,
  operation: { ...payload.operation, operationType: "REFUND" },
};

const createdAt = Temporal.Instant.from("2026-06-01T10:00:00Z");

const pendingAttempt = {
  id: "attempt-id",
  workspaceReservationId: "reservation-id",
  provider: "nexi",
  providerOrderId: "provider-order-id",
  state: "pending",
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  createdAt,
  updatedAt: createdAt,
};

const expiredAttempt = { ...pendingAttempt, state: "expired" };

const reservation = { id: "reservation-id", correlationId: "correlation-id" };

const verification = (
  status: PaymentVerificationResult["status"],
  overrides: Partial<PaymentVerificationResult["provider"]> = {},
  mismatches: PaymentVerificationResult["mismatches"] = []
): PaymentVerificationResult => ({
  status,
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
    amount: "35000",
    currency: "CZK",
    orderStatus: status === "success" ? "EXECUTED" : "DECLINED",
    captureExecuted: status === "success",
    ...overrides,
  },
  mismatches,
});

const receivedEvent = (state: string) => ({
  id: "webhook-row-id",
  eventId: "event-id",
  state,
});

const transition = (changed: boolean, state: string) => ({
  attempt: { ...pendingAttempt, state },
  changed,
  timestamp: createdAt,
});

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
  paymentReference: { paymentAttemptId: "attempt-id" } as never,
  message: "The payment attempt is no longer pending.",
});

/** Collaborators of a webhook that verifies, marks paid and fulfills. */
const paidCollaborators = (overrides: Collaborators = {}): Collaborators => ({
  ...overrides,
  webhookEvents: {
    insertReceived: succeed({
      status: "inserted",
      event: receivedEvent("received"),
    }),
    claimRetry: succeed("claimed"),
    linkPaymentAttempt: succeed(undefined),
    markProcessed: succeed(undefined),
    markFailed: succeed(undefined),
    ...overrides.webhookEvents,
  },
  paymentAttempts: {
    findByProviderOrderId: succeed(pendingAttempt),
    ...overrides.paymentAttempts,
  },
  reservations: {
    findById: succeed(reservation),
    ...overrides.reservations,
  },
  nexi: {
    verifyPaymentOutcome: succeed(verification("success")),
    ...overrides.nexi,
  },
  paymentLifecycle: {
    markPaid: succeed(transition(true, "paid")),
    markTerminal: succeed(transition(true, "failed")),
    ...overrides.paymentLifecycle,
  },
  fulfillment: {
    run: succeed(undefined),
    ...overrides.fulfillment,
  },
  latePaymentRecoveries: {
    start: succeed({}),
    ...overrides.latePaymentRecoveries,
  },
  latePaymentRecoveryQueue: {
    enqueue: succeed(undefined),
    ...overrides.latePaymentRecoveryQueue,
  },
  paymentRefunds: {
    reconcileAttempt: succeed({ status: "reconciled" }),
    ...overrides.paymentRefunds,
  },
});

/** Collaborators of a webhook whose Nexi verification reports `status`. */
const verifiedCollaborators = (
  result: PaymentVerificationResult,
  overrides: Collaborators = {}
) =>
  paidCollaborators({
    ...overrides,
    nexi: { verifyPaymentOutcome: succeed(result) },
  });

/** The success value, or the failure's error code and message. */
const outcomeOf = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  const failure = Cause.squash(exit.cause);
  return Predicate.hasProperty(failure, "errorCode") &&
    Predicate.hasProperty(failure, "message")
    ? { errorCode: failure.errorCode, message: failure.message }
    : failure;
};

/** The whole result or processing error, as one trace line. */
const describeExit = (exit: Exit.Exit<unknown, unknown>) => {
  if (Exit.isSuccess(exit)) {
    return `succeed ${JSON.stringify(exit.value)}`;
  }
  const failure = Cause.squash(exit.cause);
  const cause = Predicate.hasProperty(failure, "cause")
    ? failure.cause
    : undefined;
  return `fail ${JSON.stringify({
    ...(Predicate.isObject(failure) ? failure : { failure }),
    message: Predicate.hasProperty(failure, "message")
      ? failure.message
      : undefined,
    cause: Predicate.isObject(cause) ? cause.constructor.name : cause,
  })}`;
};

const processNotification = async (
  collaborators: Collaborators,
  notification: Notification = payload
) => {
  const trace: EffectTrace = startEffectTrace();
  const record = (service: string, methods: Methods | undefined) =>
    trace.recordCalls(service, methods ?? {});
  const exit = await Effect.gen(function* () {
    const service = yield* NexiWebhookService;
    return yield* recordEffectTrace(
      trace,
      service.processNotification(notification)
    );
  }).pipe(
    Effect.provide(
      NexiWebhookService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(
              WebhookEventRepository,
              record("webhookEvents", collaborators.webhookEvents)
            ),
            Layer.mock(
              PaymentAttemptRepository,
              record("paymentAttempts", collaborators.paymentAttempts)
            ),
            Layer.mock(
              PaymentLifecycleRepository,
              record("paymentLifecycle", collaborators.paymentLifecycle)
            ),
            Layer.mock(
              WorkspaceReservationRepository,
              record("reservations", collaborators.reservations)
            ),
            Layer.mock(NexiService, record("nexi", collaborators.nexi)),
            Layer.mock(
              ReservationFulfillment,
              record("fulfillment", collaborators.fulfillment)
            ),
            Layer.mock(
              LatePaymentRecoveryRepository,
              record(
                "latePaymentRecoveries",
                collaborators.latePaymentRecoveries
              )
            ),
            Layer.mock(
              LatePaymentRecoveryQueueService,
              record(
                "latePaymentRecoveryQueue",
                collaborators.latePaymentRecoveryQueue
              )
            ),
            Layer.mock(
              PaymentRefundService,
              record("paymentRefunds", collaborators.paymentRefunds)
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
    trace: [...trace.entries, describeExit(exit)],
  };
};

describe("NexiWebhookService.processNotification trace", () => {
  test("fails on an invalid payload", async () => {
    const { outcome, trace } = await processNotification(paidCollaborators(), {
      operation: {},
    });

    expect(outcome).toMatchObject({ errorCode: "nexi_webhook_parse_failed" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "fail {"errorCode":"nexi_webhook_parse_failed","_tag":"NexiWebhookProcessingError","message":"Nexi webhook notification payload was invalid.","cause":"SchemaError"}",
      ]
    `);
  });

  test("fails when the event can't be recorded", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: { insertReceived: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "fail {"errorCode":"nexi_webhook_transition_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi webhook event could not be recorded.","cause":"Error"}",
      ]
    `);
  });

  test("ignores a processed duplicate", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: {
          insertReceived: succeed({
            status: "duplicate",
            event: receivedEvent("processed"),
          }),
        },
      })
    );

    expect(outcome).toMatchObject({ status: "duplicate" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Processed duplicate Nexi webhook ignored (eventId=event-id, providerOrderId=provider-order-id) {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"duplicate","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("ignores a duplicate a concurrent delivery already processed", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: {
          insertReceived: succeed({
            status: "duplicate",
            event: receivedEvent("failed"),
          }),
          claimRetry: succeed("processed"),
        },
      })
    );

    expect(outcome).toMatchObject({ status: "duplicate" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.claimRetry(type=eventId, eventId=event-id)",
        "Info Concurrent duplicate Nexi webhook already processed (eventId=event-id, providerOrderId=provider-order-id) {eventId,operationId,operationResult,operationType,provider,providerOrderId,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"duplicate","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("retries a claimed unprocessed duplicate", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: {
          insertReceived: succeed({
            status: "duplicate",
            event: receivedEvent("failed"),
          }),
          claimRetry: succeed("claimed"),
        },
      })
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.claimRetry(type=eventId, eventId=event-id)",
        "Warn Retrying unprocessed duplicate Nexi webhook (eventId=event-id, providerOrderId=provider-order-id, previousState=failed) {eventId,operationId,operationResult,operationType,provider,providerOrderId,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,retryClaim,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,retryClaim,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,retryClaim,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,retryClaim,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "Info Nexi webhook paid order fulfilled {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,retryClaim,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("fails when a duplicate's retry can't be claimed", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: {
          insertReceived: succeed({
            status: "duplicate",
            event: receivedEvent("received"),
          }),
          claimRetry: fail(new Error("db down")),
        },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.claimRetry(type=eventId, eventId=event-id)",
        "fail {"errorCode":"nexi_webhook_transition_failed","_tag":"NexiWebhookProcessingError","message":"Nexi webhook processing failed.","cause":"Error"}",
      ]
    `);
  });

  test("fails when the payment attempt can't be loaded", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: { findByProviderOrderId: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({ errorCode: "nexi_webhook_unknown_order" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "fail {"errorCode":"nexi_webhook_unknown_order","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Payment attempt could not be loaded for Nexi webhook.","cause":"Error"}",
      ]
    `);
  });

  test("marks the event failed for an unknown payment attempt", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: { findByProviderOrderId: succeed(null) },
      })
    );

    expect(outcome).toMatchObject({ errorCode: "nexi_webhook_unknown_order" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook referenced unknown payment attempt {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_unknown_order)",
        "fail {"errorCode":"nexi_webhook_unknown_order","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi webhook referenced an unknown payment attempt."}",
      ]
    `);
  });

  test("still fails when the failed-state marker fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: { findByProviderOrderId: succeed(null) },
        webhookEvents: { markFailed: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({ errorCode: "nexi_webhook_unknown_order" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook referenced unknown payment attempt {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_unknown_order)",
        "Error Nexi webhook failed-state marker failed (identity=<Object>, errorCode=nexi_webhook_unknown_order, cause=<Error>) {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "fail {"errorCode":"nexi_webhook_unknown_order","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi webhook referenced an unknown payment attempt."}",
      ]
    `);
  });

  test("continues when the payment attempt link fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: { linkPaymentAttempt: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Warn Nexi webhook payment attempt link failed (eventId=event-id, paymentAttemptId=attempt-id, providerOrderId=provider-order-id, cause=<Error>) {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "Info Nexi webhook paid order fulfilled {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("fails when the reservation can't be loaded", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        reservations: { findById: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({ errorCode: "nexi_webhook_unknown_order" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "fail {"errorCode":"nexi_webhook_unknown_order","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Workspace reservation could not be loaded for Nexi webhook.","cause":"Error"}",
      ]
    `);
  });

  test("marks the event failed for an unknown reservation", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({ reservations: { findById: succeed(null) } })
    );

    expect(outcome).toMatchObject({ errorCode: "nexi_webhook_unknown_order" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook referenced unknown workspace reservation {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_unknown_order)",
        "fail {"errorCode":"nexi_webhook_unknown_order","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi webhook referenced an unknown workspace reservation."}",
      ]
    `);
  });

  test("marks the event failed on a security token mismatch", async () => {
    const { outcome, trace } = await processNotification(paidCollaborators(), {
      ...payload,
      securityToken: "other-token",
    });

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_verification_mismatch",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook security token mismatch detected {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_verification_mismatch)",
        "fail {"errorCode":"nexi_webhook_verification_mismatch","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi webhook security token did not match."}",
      ]
    `);
  });

  test("verifies a notification without a security token", async () => {
    const { securityToken: _omitted, ...withoutToken } = payload;
    const { outcome, trace } = await processNotification(
      paidCollaborators(),
      withoutToken
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "Info Nexi webhook paid order fulfilled {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("marks the event failed for an attempt without a stored token", async () => {
    const { securityToken: _omitted, ...withoutToken } = payload;
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: {
          findByProviderOrderId: succeed({
            ...pendingAttempt,
            securityToken: null,
          }),
        },
      }),
      withoutToken
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_missing_security_token",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook payment attempt is missing security token {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_missing_security_token)",
        "fail {"errorCode":"nexi_webhook_missing_security_token","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Payment attempt has no stored Nexi security token."}",
      ]
    `);
  });

  test("marks the event failed for a non-Nexi payment attempt", async () => {
    const { securityToken: _omitted, ...withoutToken } = payload;
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: {
          findByProviderOrderId: succeed({
            ...pendingAttempt,
            providerOrderId: null,
          }),
        },
      }),
      withoutToken
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_missing_security_token",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook payment attempt is missing security token {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_missing_security_token)",
        "fail {"errorCode":"nexi_webhook_missing_security_token","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Payment attempt has no stored Nexi security token."}",
      ]
    `);
  });

  test("reconciles a refund notification without a payment transition", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators(),
      refundPayload
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook refund reconciliation started {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentRefunds.reconcileAttempt(attempt=<Object>, correlationId=correlation-id)",
        "Info Nexi webhook refund reconciliation completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,refundResult,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,refundResult,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,refundResult,reservationId,reservationState,result,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("marks the event failed when refund reconciliation fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentRefunds: { reconcileAttempt: fail(new Error("nexi down")) },
      }),
      refundPayload
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_refund_reconciliation_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook refund reconciliation started {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentRefunds.reconcileAttempt(attempt=<Object>, correlationId=correlation-id)",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_refund_reconciliation_failed)",
        "fail {"errorCode":"nexi_webhook_refund_reconciliation_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi refund could not be reconciled.","cause":"Error"}",
      ]
    `);
  });

  test("marks the event failed for an invalid attempt currency", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: {
          findByProviderOrderId: succeed({
            ...pendingAttempt,
            amount: { ...pendingAttempt.amount, currency: "XXX" },
          }),
        },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_invalid_currency",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_invalid_currency)",
        "fail {"errorCode":"nexi_webhook_invalid_currency","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Payment attempt has an invalid Nexi currency.","cause":"SchemaError"}",
      ]
    `);
  });

  test("marks the event failed when provider verification fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        nexi: { verifyPaymentOutcome: fail(new Error("nexi down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_verification_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_verification_failed)",
        "fail {"errorCode":"nexi_webhook_verification_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi provider verification failed.","cause":"Error"}",
      ]
    `);
  });

  test("marks the event failed on a verification mismatch", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(verification("success", {}, ["amount"]))
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_verification_mismatch",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi webhook verification mismatch detected (verification=<Object>) {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_verification_mismatch)",
        "fail {"errorCode":"nexi_webhook_verification_mismatch","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi payment verification returned local fact mismatches."}",
      ]
    `);
  });

  test("marks paid, captures completion, fulfills and accepts", async () => {
    const { outcome, trace } = await processNotification(paidCollaborators());

    expect(outcome).toEqual({
      status: "accepted",
      eventId: "event-id",
      orderId: "provider-order-id",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "Info Nexi webhook paid order fulfilled {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("skips the completion event for an unchanged paid transition", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentLifecycle: { markPaid: succeed(transition(false, "paid")) },
      })
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "Info Nexi webhook paid order fulfilled {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("fails when the paid transition fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentLifecycle: { markPaid: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "fail {"errorCode":"nexi_webhook_transition_failed","_tag":"NexiWebhookProcessingError","message":"Nexi webhook processing failed.","cause":"Error"}",
      ]
    `);
  });

  test("marks the event failed when fulfillment fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        fulfillment: { run: fail(new Error("dotypos down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_fulfillment_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_fulfillment_failed)",
        "fail {"errorCode":"nexi_webhook_fulfillment_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Paid workspace reservation fulfillment failed.","cause":"Error"}",
      ]
    `);
  });

  test("fails when the processed marker fails", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        webhookEvents: { markProcessed: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook paid transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markPaid(id=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, paidAt=<Instant>)",
        "call checkoutAnalytics.paymentCompleted(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked paid {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call fulfillment.run(reservation-id)",
        "Info Nexi webhook paid order fulfilled {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "fail {"errorCode":"nexi_webhook_transition_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi webhook event could not be marked processed.","cause":"Error"}",
      ]
    `);
  });

  test("starts and enqueues late-payment recovery for a terminal attempt", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: { findByProviderOrderId: succeed(expiredAttempt) },
      })
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi payment settled after the local payment attempt became terminal (eventId=event-id, paymentAttemptId=attempt-id, paymentAttemptState=expired, providerOrderId=provider-order-id, reservationId=reservation-id) {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call latePaymentRecoveries.start(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, verifiedPaidAt=<Instant>)",
        "call latePaymentRecoveryQueue.enqueue(paymentAttemptId=attempt-id)",
        "Info Nexi webhook verification did not require payment transition {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("marks the event failed when late-payment recovery can't start", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: { findByProviderOrderId: succeed(expiredAttempt) },
        latePaymentRecoveries: { start: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_late_payment_recovery_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi payment settled after the local payment attempt became terminal (eventId=event-id, paymentAttemptId=attempt-id, paymentAttemptState=expired, providerOrderId=provider-order-id, reservationId=reservation-id) {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call latePaymentRecoveries.start(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, verifiedPaidAt=<Instant>)",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_late_payment_recovery_failed)",
        "fail {"errorCode":"nexi_webhook_late_payment_recovery_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi late-payment recovery could not be started.","cause":"Error"}",
      ]
    `);
  });

  test("marks the event failed when late-payment recovery can't be enqueued", async () => {
    const { outcome, trace } = await processNotification(
      paidCollaborators({
        paymentAttempts: { findByProviderOrderId: succeed(expiredAttempt) },
        latePaymentRecoveryQueue: { enqueue: fail(new Error("queue down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_late_payment_recovery_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Warn Nexi payment settled after the local payment attempt became terminal (eventId=event-id, paymentAttemptId=attempt-id, paymentAttemptState=expired, providerOrderId=provider-order-id, reservationId=reservation-id) {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call latePaymentRecoveries.start(paymentAttemptId=attempt-id, workspaceReservationId=reservation-id, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXECUTED, verifiedPaidAt=<Instant>)",
        "call latePaymentRecoveryQueue.enqueue(paymentAttemptId=attempt-id)",
        "call webhookEvents.markFailed(type=eventId, eventId=event-id, errorCode=nexi_webhook_late_payment_recovery_failed)",
        "fail {"errorCode":"nexi_webhook_late_payment_recovery_failed","eventId":"event-id","orderId":"provider-order-id","_tag":"NexiWebhookProcessingError","message":"Nexi late-payment recovery could not be started.","cause":"Error"}",
      ]
    `);
  });

  test("marks a declined payment failed and captures the failure", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(verification("failure"))
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook terminal transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=DECLINED)",
        "call checkoutAnalytics.paymentFailed(attempt=<Object>, failureReason=nexi_payment_failed, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked terminal {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("marks a cancelled payment cancelled and captures abandonment", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(
        verification("failure", { orderStatus: "CANCELED" }),
        {
          paymentLifecycle: {
            markTerminal: succeed(transition(true, "cancelled")),
          },
        }
      )
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook terminal transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=cancelled, failureCode=nexi_payment_failed, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=CANCELED)",
        "call checkoutAnalytics.paymentAbandoned(attempt=<Object>, timestamp=<Instant>)",
        "Info Nexi webhook payment attempt marked terminal {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("skips the lifecycle event for an unchanged terminal transition", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(
        verification("failure", { orderStatus: "EXPIRED" }),
        {
          paymentLifecycle: {
            markTerminal: succeed(transition(false, "expired")),
          },
        }
      )
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook terminal transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=expired, failureCode=nexi_payment_failed, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=EXPIRED)",
        "Info Nexi webhook payment attempt marked terminal {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("accepts a terminal transition that no longer applies", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(verification("failure"), {
        paymentLifecycle: { markTerminal: fail(paymentLifecycleStateError) },
      })
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook terminal transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=DECLINED)",
        "Warn Nexi webhook terminal transition no longer applies (cause=<PaymentLifecycleStateError>) {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt marked terminal {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("fails when the terminal transition fails otherwise", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(verification("failure"), {
        paymentLifecycle: { markTerminal: fail(new Error("db down")) },
      })
    );

    expect(outcome).toMatchObject({
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook terminal transition started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,failureKind,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,terminalState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentLifecycle.markTerminal(id=attempt-id, workspaceReservationId=reservation-id, state=failed, failureCode=nexi_payment_failed, webhookEventId=event-id, providerOperationId=operation-id, providerStatus=DECLINED)",
        "fail {"errorCode":"nexi_webhook_transition_failed","_tag":"NexiWebhookProcessingError","message":"Nexi webhook processing failed.","cause":"Error"}",
      ]
    `);
  });

  test("accepts a pending verification without a payment transition", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(verification("pending"))
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook verification did not require payment transition {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });

  test("accepts a pending verification of a terminal attempt without recovery", async () => {
    const { outcome, trace } = await processNotification(
      verifiedCollaborators(verification("pending"), {
        paymentAttempts: { findByProviderOrderId: succeed(expiredAttempt) },
      })
    );

    expect(outcome).toMatchObject({ status: "accepted" });
    expect(trace).toMatchInlineSnapshot(`
      [
        "span nexiWebhook.processNotification",
        "Info Nexi webhook processing started {provider} in nexiWebhook.processNotification",
        "Info Nexi webhook notification decoded {eventId,operationId,operationResult,operationType,provider,providerOrderId} in nexiWebhook.processNotification",
        "call webhookEvents.insertReceived(eventId=event-id, providerOrderId=provider-order-id, receivedAt=<Instant>)",
        "Info Nexi webhook event recorded {eventId,operationId,operationResult,operationType,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call paymentAttempts.findByProviderOrderId(provider-order-id)",
        "Debug Nexi webhook payment attempt lookup completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment attempt resolved {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.linkPaymentAttempt(type=eventId, eventId=event-id, paymentAttemptId=attempt-id)",
        "Debug Nexi webhook payment attempt link completed {eventId,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,provider,providerOrderId,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call reservations.findById(reservation-id)",
        "Debug Nexi webhook workspace reservation lookup completed {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook workspace reservation resolved {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook security token checked {activePaymentAttemptId,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook currency decoded {activePaymentAttemptId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook payment verification started {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,reservationId,reservationState,tokenCheck,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call nexi.verifyPaymentOutcome(orderId=provider-order-id, correlationId=correlation-id, amount=35000, currency=EUR, securityToken=security-token)",
        "Info Nexi webhook payment verification completed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Debug Nexi webhook provider metadata resolved {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook verification did not require payment transition {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "call webhookEvents.markProcessed(type=eventId, eventId=event-id, processedAt=<Instant>)",
        "Info Nexi webhook event marked processed {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "Info Nexi webhook processing accepted {activePaymentAttemptId,amount,correlationId,currency,dotyposReservationId,eventId,fulfillmentState,operationId,operationResult,operationType,paymentAttemptId,paymentAttemptState,paymentState,provider,providerMetadata,providerOrderId,providerOrderStatus,reservationId,reservationState,result,tokenCheck,verificationMismatches,verificationStatus,webhookEventId,webhookEventInsertStatus,webhookEventState} in nexiWebhook.processNotification",
        "succeed {"status":"accepted","eventId":"event-id","orderId":"provider-order-id"}",
      ]
    `);
  });
});
