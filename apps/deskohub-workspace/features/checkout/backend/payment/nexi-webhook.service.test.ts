import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { IWorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { CapturePostHogEventInput } from "@/shared/backend/analytics/posthog-event.service";
import {
  WorkspacePaidFulfillmentError,
  type WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType,
} from "../fulfillment/paid-fulfillment.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import type { IPaymentLifecycleRepository } from "../repositories/payment-lifecycle.repository";
import type { IWebhookEventRepository as WebhookEventRepositoryType } from "../repositories/webhook-event.repository";

type NexiServiceType = typeof NexiServiceTag.Service;

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

const attempt = {
  id: "attempt-id",
  workspaceReservationId: "reservation-id",
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "pending" as const,
  amount: {
    value: 35_000,
    exponent: 2,
    currency: "CZK",
  },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: Temporal.Instant.from("2026-06-01T10:00:00Z"),
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

const reservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
};

const verification: PaymentVerificationResult = {
  status: "success",
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
    amount: "35000",
    currency: "CZK",
    orderStatus: "EXECUTED",
    captureExecuted: true,
  },
  mismatches: [],
};

const receivedEvent = {
  id: "webhook-row-id",
  provider: "nexi" as const,
  eventId: "event-id",
  paymentAttemptId: null,
  providerOrderId: "provider-order-id",
  receivedAt: Temporal.Now.instant(),
  processedAt: null,
  state: "received" as const,
  errorCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

type NexiWebhookTestServices = {
  readonly webhookEvents: WebhookEventRepositoryType;
  readonly paymentAttempts: PaymentAttemptRepositoryType;
  readonly paymentLifecycle: IPaymentLifecycleRepository;
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly nexi: NexiServiceType;
  readonly fulfillment: WorkspacePaidFulfillmentServiceType;
  readonly posthog?: {
    readonly capture: (input: CapturePostHogEventInput) => Effect.Effect<void>;
  };
  readonly latePaymentRecoveries?: object;
  readonly latePaymentRecoveryQueue?: object;
  readonly paymentRefunds?: object;
  readonly notification?: unknown;
};

const buildWebhookEffect = async (services: NexiWebhookTestServices) => {
  const { NexiService } = await import("@deskohub/nexi");
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { NexiWebhookService } = await import("./nexi-webhook.service");
  const { PaymentAttemptRepository } = await import(
    "../repositories/payment-attempt.repository"
  );
  const { PaymentLifecycleRepository } = await import(
    "../repositories/payment-lifecycle.repository"
  );
  const { LatePaymentRecoveryRepository } = await import(
    "../repositories/late-payment-recovery.repository"
  );
  const { LatePaymentRecoveryQueueService } = await import(
    "./late-payment-recovery-queue.service"
  );
  const { WorkspacePaidFulfillmentService } = await import(
    "../fulfillment/paid-fulfillment.service"
  );
  const { ReservationHoldCleanupService } = await import(
    "../holds/reservation-hold-cleanup.service"
  );
  const { WebhookEventRepository } = await import(
    "../repositories/webhook-event.repository"
  );
  const { PaymentRefundService } = await import("./payment-refund.service");

  return Effect.gen(function* () {
    const service = yield* NexiWebhookService;
    return yield* service.processNotification(services.notification ?? payload);
  }).pipe(
    Effect.provide(
      NexiWebhookService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WebhookEventRepository, services.webhookEvents),
            Layer.mock(PaymentAttemptRepository, services.paymentAttempts),
            Layer.mock(PaymentLifecycleRepository, services.paymentLifecycle),
            Layer.mock(WorkspaceReservationRepository, services.reservations),
            Layer.mock(ReservationHoldCleanupService, {
              cancelOrderHold: mock(() => Effect.die("unused")),
              sweepExpiredHolds: mock(() => Effect.die("unused")),
            }),
            Layer.mock(NexiService, services.nexi),
            Layer.mock(WorkspacePaidFulfillmentService, services.fulfillment),
            Layer.mock(LatePaymentRecoveryRepository, {
              start: mock(() => Effect.die("unused")),
              findByPaymentAttemptId: mock(() => Effect.die("unused")),
              claim: mock(() => Effect.die("unused")),
              hasNewerActiveReservation: mock(() => Effect.die("unused")),
              completeUsingOriginalReservation: mock(() =>
                Effect.die("unused")
              ),
              completeWithReplacement: mock(() => Effect.die("unused")),
              requireRefund: mock(() => Effect.die("unused")),
              requireReview: mock(() => Effect.die("unused")),
              ...services.latePaymentRecoveries,
            }),
            Layer.mock(LatePaymentRecoveryQueueService, {
              enqueue: mock(() => Effect.die("unused")),
              ...services.latePaymentRecoveryQueue,
            }),
            Layer.mock(PostHogEventService, {
              capture: mock(() => Effect.void),
              ...services.posthog,
            }),
            Layer.mock(PaymentRefundService, {
              reconcileAttempt: mock(() => Effect.die("unused")),
              reconcileAwaitingRefunds: mock(() => Effect.die("unused")),
              ...services.paymentRefunds,
            })
          )
        )
      )
    )
  );
};

describe("NexiWebhookService", () => {
  test("links the attempt, verifies, marks paid, fulfills, and marks processed", async () => {
    const linkPaymentAttempt = mock(() => Effect.void);
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaidForReservation = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "paid" as const },
        changed: true,
        timestamp: Temporal.Now.instant(),
      })
    );
    const verifyPaymentOutcome = mock(() => Effect.succeed(verification));
    const fulfillPaidOrder = mock(() => Effect.void);
    const capture = mock((_input: CapturePostHogEventInput) => Effect.void);

    const result = await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt,
          markProcessed,
          markFailed,
          claimRetry: mock(() => Effect.die("unused")),
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() => Effect.succeed(attempt)),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid: markPaidForReservation,
          markTerminal: mock(() => Effect.die("unused")),
        },
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        },
        nexi: {
          verifyPaymentOutcome,
        },
        fulfillment: {
          fulfillPaidOrder,
        } satisfies WorkspacePaidFulfillmentServiceType,
        posthog: { capture },
      })
    );

    expect(result).toEqual({
      status: "accepted",
      eventId: "event-id",
      orderId: "provider-order-id",
    });
    expect(linkPaymentAttempt).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      paymentAttemptId: "attempt-id",
    });
    expect(verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
      amount: "35000",
      currency: "EUR",
      securityToken: "security-token",
    });
    expect(markPaidForReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        workspaceReservationId: "reservation-id",
        webhookEventId: "event-id",
      })
    );
    expect(fulfillPaidOrder).toHaveBeenCalledWith({
      orderId: "reservation-id",
    });
    expect(markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eventId", eventId: "event-id" })
    );
    expect(markFailed).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "reservation-id",
        event: "payment completed",
      })
    );
  });

  test("queues recovery for a late successful payment without fulfilling", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaidForReservation = mock(() => Effect.die("not used"));
    const fulfillPaidOrder = mock(() => Effect.die("not used"));
    const start = mock(() =>
      Effect.succeed({ paymentAttemptId: "attempt-id" } as never)
    );
    const enqueue = mock(() => Effect.void);

    const result = await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed,
          markFailed,
          claimRetry: mock(() => Effect.die("unused")),
        },
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              state: "expired" as const,
              failureCode: "payment_abandoned_after_provider_cutoff",
            })
          ),
        },
        paymentLifecycle: {
          createPendingNexiAttempt: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markPaid: markPaidForReservation,
          markTerminal: mock(() => Effect.die("unused")),
        },
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        },
        nexi: {
          verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
        },
        fulfillment: {
          fulfillPaidOrder,
        },
        latePaymentRecoveries: { start },
        latePaymentRecoveryQueue: { enqueue },
      })
    );

    expect(result).toEqual({
      status: "accepted",
      eventId: "event-id",
      orderId: "provider-order-id",
    });
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAttemptId: "attempt-id",
        workspaceReservationId: "reservation-id",
        webhookEventId: "event-id",
        providerOperationId: "operation-id",
      })
    );
    expect(enqueue).toHaveBeenCalledWith({ paymentAttemptId: "attempt-id" });
    expect(markPaidForReservation).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalled();
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("marks the webhook failed and not processed when paid fulfillment fails", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect({
          webhookEvents: {
            insertReceived: mock(() =>
              Effect.succeed({ status: "inserted", event: receivedEvent })
            ),
            linkPaymentAttempt: mock(() => Effect.void),
            markProcessed,
            markFailed,
            claimRetry: mock(() => Effect.die("unused")),
          },
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          },
          paymentLifecycle: {
            createPendingNexiAttempt: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markPaid: mock(() =>
              Effect.succeed({
                attempt: { ...attempt, state: "paid" as const },
                changed: true,
                timestamp: Temporal.Now.instant(),
              })
            ),
            markTerminal: mock(() => Effect.die("unused")),
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          },
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          },
          fulfillment: {
            fulfillPaidOrder: mock(() =>
              Effect.fail(
                new WorkspacePaidFulfillmentError({
                  orderId: "reservation-id",
                  failureCode: "fulfillment_email_failed",
                  message: "email failed",
                })
              )
            ),
          } satisfies WorkspacePaidFulfillmentServiceType,
        })
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.errorCode).toBe("nexi_webhook_fulfillment_failed");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_fulfillment_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });

  const refundNotification = {
    ...payload,
    eventId: "refund-event-id",
    operation: {
      ...payload.operation,
      operationId: "refund-operation-id",
      operationType: "REFUND",
      operationResult: "EXECUTED",
      operationAmount: "10000",
    },
  };

  const paidAttempt = { ...attempt, state: "paid" as const };

  const refundServices = (overrides: {
    readonly markProcessed: () => Effect.Effect<void>;
    readonly markFailed: () => Effect.Effect<void>;
    readonly reconcileAttempt: () => Effect.Effect<unknown, unknown>;
    readonly markPaid: () => Effect.Effect<never>;
    readonly verifyPaymentOutcome: () => Effect.Effect<never>;
    readonly fulfillPaidOrder: () => Effect.Effect<never>;
  }) =>
    ({
      notification: refundNotification,
      webhookEvents: {
        insertReceived: mock(() =>
          Effect.succeed({
            status: "inserted",
            event: { ...receivedEvent, eventId: "refund-event-id" },
          })
        ),
        linkPaymentAttempt: mock(() => Effect.void),
        markProcessed: overrides.markProcessed,
        markFailed: overrides.markFailed,
        claimRetry: mock(() => Effect.die("unused")),
      },
      paymentAttempts: {
        findByProviderOrderId: mock(() => Effect.succeed(paidAttempt)),
      },
      paymentLifecycle: {
        createPendingNexiAttempt: mock(() => Effect.die("unused")),
        attachProviderSession: mock(() => Effect.die("unused")),
        markPaid: overrides.markPaid,
        markTerminal: mock(() => Effect.die("unused")),
      },
      reservations: {
        findById: mock(() => Effect.succeed(reservation as never)),
      },
      nexi: {
        verifyPaymentOutcome: overrides.verifyPaymentOutcome,
      },
      fulfillment: {
        fulfillPaidOrder: overrides.fulfillPaidOrder,
      },
      paymentRefunds: { reconcileAttempt: overrides.reconcileAttempt },
    }) as NexiWebhookTestServices;

  test("records a refund notification without re-running payment or fulfillment", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const reconcileAttempt = mock(() => Effect.succeed("recorded" as const));
    const markPaid = mock(() => Effect.die("not used"));
    const verifyPaymentOutcome = mock(() => Effect.die("not used"));
    const fulfillPaidOrder = mock(() => Effect.die("not used"));

    const result = await Effect.runPromise(
      await buildWebhookEffect(
        refundServices({
          markProcessed,
          markFailed,
          reconcileAttempt,
          markPaid,
          verifyPaymentOutcome,
          fulfillPaidOrder,
        })
      )
    );

    expect(result).toEqual({
      status: "accepted",
      eventId: "refund-event-id",
      orderId: "provider-order-id",
    });
    expect(reconcileAttempt).toHaveBeenCalledWith({
      attempt: paidAttempt,
      correlationId: "correlation-id",
    });
    expect(verifyPaymentOutcome).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eventId", eventId: "refund-event-id" })
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  test("marks a refund notification failed for retry when reconciliation fails", async () => {
    const { PaymentRefundReconciliationError } = await import(
      "./payment-refund.service"
    );
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect(
          refundServices({
            markProcessed,
            markFailed,
            reconcileAttempt: mock(() =>
              Effect.fail(
                new PaymentRefundReconciliationError({
                  message: "Nexi refund reconciliation failed.",
                  cause: new Error("provider unavailable"),
                })
              )
            ),
            markPaid: mock(() => Effect.die("not used")),
            verifyPaymentOutcome: mock(() => Effect.die("not used")),
            fulfillPaidOrder: mock(() => Effect.die("not used")),
          })
        )
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure") throw new Error("Expected failure");
    expect(result.failure.errorCode).toBe(
      "nexi_webhook_refund_reconciliation_failed"
    );
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "refund-event-id",
      errorCode: "nexi_webhook_refund_reconciliation_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });
});
