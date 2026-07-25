import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import {
  WorkspacePaidFulfillmentError,
  type WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType,
} from "../fulfillment/paid-fulfillment.service";
import type { ReservationHoldCleanupService as ReservationHoldCleanupServiceType } from "../holds/reservation-hold-cleanup.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleStateError,
} from "../repositories/payment-lifecycle.repository";
import type { WebhookEventRepository as WebhookEventRepositoryType } from "../repositories/webhook-event.repository";

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
    operationCurrency: "EUR",
  },
};
const failurePayload = {
  ...payload,
  operation: {
    ...payload.operation,
    operationResult: "DECLINED",
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
  activePaymentAttemptId: "attempt-id",
};

const verification: PaymentVerificationResult = {
  status: "success",
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationType: "CAPTURE",
    amount: "35000",
    currency: "EUR",
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
  readonly paymentLifecycle: Partial<IPaymentLifecycleRepository>;
  readonly reservations: WorkspaceReservationRepositoryType;
  readonly nexi: NexiServiceType;
  readonly fulfillment: WorkspacePaidFulfillmentServiceType;
};

const buildWebhookEffect = async (
  services: NexiWebhookTestServices,
  notification: unknown = payload
) => {
  const paymentLifecycle: IPaymentLifecycleRepository = {
    admitPaymentStart: () => Effect.die("unused"),
    completeInternalPayment: () => Effect.die("unused"),
    attachProviderSession: () => Effect.die("unused"),
    markProviderStartFailed: () => Effect.die("unused"),
    claimProviderReconciliation: () =>
      services.paymentAttempts
        .findByProviderOrderId(payload.operation.orderId)
        .pipe(
          Effect.map((attempt) =>
            attempt
              ? {
                  outcome: "claimed" as const,
                  claimId: "claim-id",
                  attempt,
                }
              : { outcome: "not_found" as const }
          )
        ),
    releaseProviderReconciliation: () => Effect.void,
    recordEvidenceConflict: () => Effect.die("unused"),
    markPaid: () => Effect.die("unused"),
    markTerminal: () => Effect.die("unused"),
    ...services.paymentLifecycle,
  };
  const { NexiService } = await import("@deskohub/nexi");
  const { WorkspaceReservationRepository } = await import(
    "@/features/reservation/backend/workspace-reservation.repository"
  );
  const { PostHogEventService } = await import(
    "@/shared/backend/analytics/posthog-event.service"
  );
  const { NexiWebhookService, NexiWebhookServiceLive } = await import(
    "./nexi-webhook.service"
  );
  const { PaymentAttemptRepository } = await import(
    "../repositories/payment-attempt.repository"
  );
  const { PaymentLifecycleRepository } = await import(
    "../repositories/payment-lifecycle.repository"
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

  return Effect.gen(function* () {
    const service = yield* NexiWebhookService;
    return yield* service.processNotification(notification);
  }).pipe(
    Effect.provide(
      NexiWebhookServiceLive.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(WebhookEventRepository, services.webhookEvents),
            Layer.succeed(PaymentAttemptRepository, services.paymentAttempts),
            Layer.succeed(PaymentLifecycleRepository, paymentLifecycle),
            Layer.succeed(
              WorkspaceReservationRepository,
              services.reservations
            ),
            Layer.succeed(ReservationHoldCleanupService, {
              cancelOrderHold: mock(() => Effect.die("unused")),
              sweepExpiredHolds: mock(() => Effect.die("unused")),
            } as unknown as ReservationHoldCleanupServiceType),
            Layer.succeed(NexiService, services.nexi),
            Layer.succeed(
              WorkspacePaidFulfillmentService,
              services.fulfillment
            ),
            Layer.succeed(PostHogEventService, {
              capture: mock(() => Effect.void),
            })
          )
        )
      )
    )
  );
};

describe("NexiWebhookService", () => {
  test("rejects unbounded unknown identifiers before database or provider work", async () => {
    const insertReceived = mock(() => Effect.die("must not persist"));
    const findByProviderOrderId = mock(() => Effect.die("must not query"));
    const verifyPaymentOutcome = mock(() => Effect.die("must not call"));

    const exit = await Effect.runPromise(
      (
        await buildWebhookEffect(
          {
            webhookEvents: {
              insertReceived,
            } as unknown as WebhookEventRepositoryType,
            paymentAttempts: {
              findByProviderOrderId,
            } as unknown as PaymentAttemptRepositoryType,
            paymentLifecycle: {
              admitPaymentStart: () => Effect.die("unused"),
              attachProviderSession: () => Effect.die("unused"),
              markProviderStartFailed: () => Effect.die("unused"),
              claimProviderReconciliation: () => Effect.die("unused"),
              releaseProviderReconciliation: () => Effect.die("unused"),
              recordEvidenceConflict: () => Effect.die("unused"),
              markPaid: () => Effect.die("unused"),
              markTerminal: () => Effect.die("unused"),
            },
            reservations: {} as unknown as WorkspaceReservationRepositoryType,
            nexi: {
              verifyPaymentOutcome,
            } as unknown as NexiServiceType,
            fulfillment: {} as unknown as WorkspacePaidFulfillmentServiceType,
          },
          {
            eventId: "https://invalid.example/event?value=opaque",
            operation: {
              orderId: "https://invalid.example/order?value=opaque",
            },
          }
        )
      ).pipe(Effect.result)
    );

    expect(exit._tag).toBe("Failure");
    expect(insertReceived).not.toHaveBeenCalled();
    expect(findByProviderOrderId).not.toHaveBeenCalled();
    expect(verifyPaymentOutcome).not.toHaveBeenCalled();
  });

  test("settles an unattached remote order by stable identity and marks processed", async () => {
    const linkPaymentAttempt = mock(() => Effect.void);
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaidForReservation = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "paid" as const },
        changed: false,
        timestamp: Temporal.Now.instant(),
      })
    );
    const verifyPaymentOutcome = mock(() => Effect.succeed(verification));
    let reconciliationClaimHeld = true;
    const releaseProviderReconciliation = mock(() =>
      Effect.sync(() => {
        reconciliationClaimHeld = false;
      })
    );
    const fulfillPaidOrder = mock(() =>
      Effect.sync(() => {
        expect(reconciliationClaimHeld).toBeFalse();
      })
    );
    const recordEvidenceConflict = mock(() => Effect.void);

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
        } as unknown as WebhookEventRepositoryType,
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              state: "created" as const,
              securityToken: null,
              providerRedirectUrl: null,
            })
          ),
        } as unknown as PaymentAttemptRepositoryType,
        paymentLifecycle: {
          admitPaymentStart: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markProviderStartFailed: mock(() => Effect.die("unused")),
          releaseProviderReconciliation,
          recordEvidenceConflict,
          markPaid: markPaidForReservation,
          markTerminal: mock(() => Effect.die("unused")),
        },
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        } as unknown as WorkspaceReservationRepositoryType,
        nexi: {
          verifyPaymentOutcome,
        } as unknown as NexiServiceType,
        fulfillment: {
          fulfillPaidOrder,
        } satisfies WorkspacePaidFulfillmentServiceType,
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
    expect(recordEvidenceConflict).not.toHaveBeenCalled();
  });

  test("provider-verifies a replaced attempt webhook and fences contradictory late evidence", async () => {
    const markProcessed = mock(() => Effect.void);
    const recordEvidenceConflict = mock(() => Effect.void);
    const claimProviderReconciliation = mock(() =>
      Effect.die("historical attempts must not claim settlement ownership")
    );
    const markPaid = mock(() =>
      Effect.die("historical attempts must not settle")
    );
    const markTerminal = mock(() =>
      Effect.die("historical attempts must not settle")
    );
    const verifyPaymentOutcome = mock(() => Effect.succeed(verification));

    const result = await Effect.runPromise(
      await buildWebhookEffect({
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed,
          markFailed: mock(() => Effect.die("must not fail")),
          claimRetry: mock(() => Effect.die("unused")),
        } as unknown as WebhookEventRepositoryType,
        paymentAttempts: {
          findByProviderOrderId: mock(() =>
            Effect.succeed({
              ...attempt,
              state: "failed" as const,
              failureCode: "nexi_payment_failed",
              lastProviderStatus: "DECLINED",
            })
          ),
        } as unknown as PaymentAttemptRepositoryType,
        paymentLifecycle: {
          claimProviderReconciliation,
          recordEvidenceConflict,
          markPaid,
          markTerminal,
        },
        reservations: {
          findById: mock(() =>
            Effect.succeed({
              ...reservation,
              activePaymentAttemptId: "replacement-attempt-id",
            } as never)
          ),
        } as unknown as WorkspaceReservationRepositoryType,
        nexi: {
          verifyPaymentOutcome,
        } as unknown as NexiServiceType,
        fulfillment: {
          fulfillPaidOrder: mock(() => Effect.die("must not fulfill")),
        },
      })
    );

    expect(result).toEqual({
      status: "accepted",
      eventId: "event-id",
      orderId: "provider-order-id",
    });
    expect(verifyPaymentOutcome).toHaveBeenCalledTimes(1);
    expect(claimProviderReconciliation).not.toHaveBeenCalled();
    expect(recordEvidenceConflict).toHaveBeenCalledWith({
      id: "attempt-id",
      workspaceReservationId: "reservation-id",
      conflictCodes: ["provider_terminal_state"],
    });
    expect(markPaid).not.toHaveBeenCalled();
    expect(markTerminal).not.toHaveBeenCalled();
    expect(markProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ type: "eventId", eventId: "event-id" })
    );
  });

  for (const scenario of [
    {
      name: "the provider operation ID changes",
      attemptOverrides: {
        lastProviderOperationId: "previous-operation-id",
        lastProviderStatus: "DECLINED",
        failureCode: "nexi_payment_failed",
      },
    },
    {
      name: "the provider status changes",
      attemptOverrides: {
        lastProviderOperationId: "operation-id",
        lastProviderStatus: "PREVIOUSLY_DECLINED",
        failureCode: "nexi_payment_failed",
      },
    },
    {
      name: "a provider-start failure receives provider-terminal evidence",
      attemptOverrides: {
        lastProviderOperationId: null,
        lastProviderStatus: null,
        failureCode: "nexi_payment_session_failed",
      },
    },
  ] as const) {
    test(`fences a replaced failed attempt webhook when ${scenario.name}`, async () => {
      const markProcessed = mock(() => Effect.void);
      const recordEvidenceConflict = mock(() => Effect.void);
      const claimProviderReconciliation = mock(() =>
        Effect.die("historical attempts must not claim settlement ownership")
      );
      const markPaid = mock(() =>
        Effect.die("historical attempts must not settle")
      );
      const markTerminal = mock(() =>
        Effect.die("historical attempts must not settle")
      );
      const providerVerification: PaymentVerificationResult = {
        status: "failure",
        provider: {
          ...verification.provider,
          orderStatus: "DECLINED",
          captureExecuted: false,
        },
        mismatches: [],
      };

      const result = await Effect.runPromise(
        await buildWebhookEffect(
          {
            webhookEvents: {
              insertReceived: mock(() =>
                Effect.succeed({ status: "inserted", event: receivedEvent })
              ),
              linkPaymentAttempt: mock(() => Effect.void),
              markProcessed,
              markFailed: mock(() => Effect.die("must not fail")),
              claimRetry: mock(() => Effect.die("unused")),
            } as unknown as WebhookEventRepositoryType,
            paymentAttempts: {
              findByProviderOrderId: mock(() =>
                Effect.succeed({
                  ...attempt,
                  ...scenario.attemptOverrides,
                  state: "failed" as const,
                })
              ),
            } as unknown as PaymentAttemptRepositoryType,
            paymentLifecycle: {
              claimProviderReconciliation,
              recordEvidenceConflict,
              markPaid,
              markTerminal,
            },
            reservations: {
              findById: mock(() =>
                Effect.succeed({
                  ...reservation,
                  activePaymentAttemptId: "replacement-attempt-id",
                } as never)
              ),
            } as unknown as WorkspaceReservationRepositoryType,
            nexi: {
              verifyPaymentOutcome: mock(() =>
                Effect.succeed(providerVerification)
              ),
            } as unknown as NexiServiceType,
            fulfillment: {
              fulfillPaidOrder: mock(() =>
                Effect.die("historical attempts must not fulfill")
              ),
            },
          },
          failurePayload
        )
      );

      expect(result).toEqual({
        status: "accepted",
        eventId: "event-id",
        orderId: "provider-order-id",
      });
      expect(recordEvidenceConflict).toHaveBeenCalledWith({
        id: "attempt-id",
        workspaceReservationId: "reservation-id",
        conflictCodes: ["provider_terminal_state"],
      });
      expect(claimProviderReconciliation).not.toHaveBeenCalled();
      expect(markPaid).not.toHaveBeenCalled();
      expect(markTerminal).not.toHaveBeenCalled();
      expect(markProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ type: "eventId", eventId: "event-id" })
      );
    });
  }

  for (const providerStatus of ["success", "failure"] as const) {
    test(`does not let a forged webhook token fence later clean ${providerStatus} reconciliation`, async () => {
      const markProcessed = mock(() => Effect.void);
      const markFailed = mock(() => Effect.void);
      const recordEvidenceConflict = mock(() => Effect.void);
      const markPaid = mock(() =>
        Effect.succeed({
          attempt: { ...attempt, state: "paid" as const },
          changed: true,
          timestamp: Temporal.Now.instant(),
        })
      );
      const markTerminal = mock(() =>
        Effect.succeed({
          attempt: { ...attempt, state: "failed" as const },
          changed: true,
        })
      );
      const fulfillPaidOrder = mock(() => Effect.void);
      const authoritativeVerification: PaymentVerificationResult =
        providerStatus === "success"
          ? verification
          : {
              status: "failure",
              provider: {
                ...verification.provider,
                orderStatus: "DECLINED",
                captureExecuted: false,
              },
              mismatches: [],
            };
      const verifyPaymentOutcome = mock(() =>
        Effect.succeed(authoritativeVerification)
      );
      const services = {
        webhookEvents: {
          insertReceived: mock(() =>
            Effect.succeed({ status: "inserted", event: receivedEvent })
          ),
          linkPaymentAttempt: mock(() => Effect.void),
          markProcessed,
          markFailed,
          claimRetry: mock(() => Effect.die("unused")),
        } as unknown as WebhookEventRepositoryType,
        paymentAttempts: {
          findByProviderOrderId: mock(() => Effect.succeed(attempt)),
        } as unknown as PaymentAttemptRepositoryType,
        paymentLifecycle: {
          admitPaymentStart: mock(() => Effect.die("unused")),
          attachProviderSession: mock(() => Effect.die("unused")),
          markProviderStartFailed: mock(() => Effect.die("unused")),
          recordEvidenceConflict,
          markPaid,
          markTerminal,
        },
        reservations: {
          findById: mock(() => Effect.succeed(reservation as never)),
        } as unknown as WorkspaceReservationRepositoryType,
        nexi: { verifyPaymentOutcome } as unknown as NexiServiceType,
        fulfillment: { fulfillPaidOrder },
      };
      const forgedDelivery = {
        ...(providerStatus === "success" ? payload : failurePayload),
        securityToken: "forged-notification-token",
      };
      const forgedResult = await Effect.runPromise(
        Effect.result(await buildWebhookEffect(services, forgedDelivery))
      );

      expect(forgedResult._tag).toBe("Failure");
      expect(verifyPaymentOutcome).not.toHaveBeenCalled();
      expect(recordEvidenceConflict).not.toHaveBeenCalled();
      expect(markFailed).toHaveBeenCalledWith({
        type: "eventId",
        eventId: payload.eventId,
        errorCode: "nexi_webhook_verification_mismatch",
      });
      expect(markProcessed).not.toHaveBeenCalled();
      expect(markPaid).not.toHaveBeenCalled();
      expect(markTerminal).not.toHaveBeenCalled();
      expect(fulfillPaidOrder).not.toHaveBeenCalled();

      const cleanResult = await Effect.runPromise(
        await buildWebhookEffect(
          services,
          providerStatus === "success"
            ? { ...payload, eventId: "clean-success-event" }
            : { ...failurePayload, eventId: "clean-failure-event" }
        )
      );

      expect(cleanResult.status).toBe("accepted");
      expect(verifyPaymentOutcome).toHaveBeenCalledWith({
        orderId: attempt.providerOrderId,
        correlationId: reservation.correlationId,
        amount: String(attempt.amount.value),
        currency: "EUR",
        securityToken: attempt.securityToken,
      });
      expect(recordEvidenceConflict).not.toHaveBeenCalled();
      if (providerStatus === "success") {
        expect(markPaid).toHaveBeenCalledTimes(1);
        expect(markTerminal).not.toHaveBeenCalled();
        expect(fulfillPaidOrder).toHaveBeenCalledTimes(1);
      } else {
        expect(markTerminal).toHaveBeenCalledTimes(1);
        expect(markPaid).not.toHaveBeenCalled();
        expect(fulfillPaidOrder).not.toHaveBeenCalled();
      }
    });
  }

  test("settles a provider failure idempotently and marks the event processed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markTerminal = mock(() =>
      Effect.succeed({
        attempt: {
          ...attempt,
          state: "failed" as const,
          failureCode: "nexi_payment_failed",
        },
        changed: false,
        timestamp: Temporal.Now.instant(),
      })
    );

    const result = await Effect.runPromise(
      await buildWebhookEffect(
        {
          webhookEvents: {
            insertReceived: mock(() =>
              Effect.succeed({ status: "inserted", event: receivedEvent })
            ),
            linkPaymentAttempt: mock(() => Effect.void),
            markProcessed,
            markFailed: mock(() => Effect.void),
            claimRetry: mock(() => Effect.die("unused")),
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            recordEvidenceConflict: mock(() => Effect.void),
            markPaid: mock(() => Effect.die("unused")),
            markTerminal,
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() =>
              Effect.succeed({
                ...verification,
                status: "failure",
                provider: {
                  ...verification.provider,
                  orderStatus: "DECLINED",
                  captureExecuted: false,
                },
              })
            ),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        },
        failurePayload
      )
    );

    expect(result.status).toBe("accepted");
    expect(markTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        workspaceReservationId: "reservation-id",
        state: "failed",
        failureCode: "nexi_payment_failed",
        webhookEventId: "event-id",
      })
    );
    expect(markProcessed).toHaveBeenCalledTimes(1);
  });

  test("marks a contradictory terminal replay failed and never processed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect(
          {
            webhookEvents: {
              insertReceived: mock(() =>
                Effect.succeed({ status: "inserted", event: receivedEvent })
              ),
              linkPaymentAttempt: mock(() => Effect.void),
              markProcessed,
              markFailed,
              claimRetry: mock(() => Effect.die("unused")),
            } as unknown as WebhookEventRepositoryType,
            paymentAttempts: {
              findByProviderOrderId: mock(() => Effect.succeed(attempt)),
            } as unknown as PaymentAttemptRepositoryType,
            paymentLifecycle: {
              admitPaymentStart: mock(() => Effect.die("unused")),
              attachProviderSession: mock(() => Effect.die("unused")),
              markProviderStartFailed: mock(() => Effect.die("unused")),
              recordEvidenceConflict: mock(() => Effect.void),
              markPaid: mock(() => Effect.die("unused")),
              markTerminal: mock(() =>
                Effect.fail(
                  new PaymentLifecycleStateError({
                    operation: "markTerminal",
                    paymentAttemptId: attempt.id,
                    message:
                      "The terminal replay conflicts with the recorded lifecycle outcome.",
                  })
                )
              ),
            },
            reservations: {
              findById: mock(() => Effect.succeed(reservation as never)),
            } as unknown as WorkspaceReservationRepositoryType,
            nexi: {
              verifyPaymentOutcome: mock(() =>
                Effect.succeed({
                  ...verification,
                  status: "failure",
                  provider: {
                    ...verification.provider,
                    orderStatus: "DECLINED",
                    captureExecuted: false,
                  },
                })
              ),
            } as unknown as NexiServiceType,
            fulfillment: {
              fulfillPaidOrder: mock(() => Effect.die("unused")),
            },
          },
          failurePayload
        )
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });

  test("marks a contradictory paid replay failed and never processed", async () => {
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
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            recordEvidenceConflict: mock(() => Effect.void),
            markPaid: mock(() =>
              Effect.fail(
                new PaymentLifecycleStateError({
                  operation: "markPaid",
                  paymentAttemptId: attempt.id,
                  message:
                    "The paid replay conflicts with recorded provider evidence.",
                })
              )
            ),
            markTerminal: mock(() => Effect.die("unused")),
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_transition_failed",
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });

  test("keeps unsigned operation disagreement delivery-local so later clean evidence can settle", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const markPaid = mock(() =>
      Effect.succeed({
        attempt: { ...attempt, state: "paid" as const },
        changed: true,
        timestamp: Temporal.Now.instant(),
      })
    );
    const fulfillPaidOrder = mock(() => Effect.void);
    const recordEvidenceConflict = mock(() => Effect.void);
    const contradictoryPayload = {
      ...payload,
      operation: {
        ...payload.operation,
        operationId: "later-terminal-operation",
        operationResult: "REFUNDED",
        operationAmount: "34999",
        operationCurrency: "EUR",
      },
    };

    const services = {
      webhookEvents: {
        insertReceived: mock(() =>
          Effect.succeed({ status: "inserted", event: receivedEvent })
        ),
        linkPaymentAttempt: mock(() => Effect.void),
        markProcessed,
        markFailed,
        claimRetry: mock(() => Effect.die("unused")),
      } as unknown as WebhookEventRepositoryType,
      paymentAttempts: {
        findByProviderOrderId: mock(() => Effect.succeed(attempt)),
      } as unknown as PaymentAttemptRepositoryType,
      paymentLifecycle: {
        admitPaymentStart: mock(() => Effect.die("unused")),
        attachProviderSession: mock(() => Effect.die("unused")),
        markProviderStartFailed: mock(() => Effect.die("unused")),
        recordEvidenceConflict,
        markPaid,
        markTerminal: mock(() => Effect.die("unused")),
      },
      reservations: {
        findById: mock(() => Effect.succeed(reservation as never)),
      } as unknown as WorkspaceReservationRepositoryType,
      nexi: {
        verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
      } as unknown as NexiServiceType,
      fulfillment: { fulfillPaidOrder },
    };
    const result = await Effect.runPromise(
      Effect.result(await buildWebhookEffect(services, contradictoryPayload))
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_verification_mismatch",
    });
    expect(markProcessed).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(recordEvidenceConflict).not.toHaveBeenCalled();

    const cleanResult = await Effect.runPromise(
      await buildWebhookEffect(services, {
        ...payload,
        eventId: "clean-operation-event",
      })
    );

    expect(cleanResult.status).toBe("accepted");
    expect(recordEvidenceConflict).not.toHaveBeenCalled();
    expect(markPaid).toHaveBeenCalledTimes(1);
    expect(fulfillPaidOrder).toHaveBeenCalledTimes(1);
  });

  for (const providerStatus of ["success", "failure"] as const) {
    test(`keeps later clean ${providerStatus} evidence unprocessed after a durable conflict`, async () => {
      const markProcessed = mock(() => Effect.void);
      const markFailed = mock(() => Effect.void);
      const recordEvidenceConflict = mock(() => Effect.void);
      const fulfillPaidOrder = mock(() => Effect.void);
      const lifecycleConflict = new PaymentLifecycleStateError({
        operation: providerStatus === "success" ? "markPaid" : "markTerminal",
        paymentAttemptId: attempt.id,
        message: "Durable provider evidence conflict requires manual review.",
        reason: "provider_evidence_conflict",
      });
      const markPaid = mock(() => Effect.fail(lifecycleConflict));
      const markTerminal = mock(() => Effect.fail(lifecycleConflict));
      const providerVerification =
        providerStatus === "success"
          ? verification
          : {
              ...verification,
              status: "failure" as const,
              provider: {
                ...verification.provider,
                orderStatus: "DECLINED",
                captureExecuted: false,
              },
            };

      const result = await Effect.runPromise(
        Effect.result(
          await buildWebhookEffect(
            {
              webhookEvents: {
                insertReceived: mock(() =>
                  Effect.succeed({ status: "inserted", event: receivedEvent })
                ),
                linkPaymentAttempt: mock(() => Effect.void),
                markProcessed,
                markFailed,
                claimRetry: mock(() => Effect.die("unused")),
              } as unknown as WebhookEventRepositoryType,
              paymentAttempts: {
                findByProviderOrderId: mock(() => Effect.succeed(attempt)),
              } as unknown as PaymentAttemptRepositoryType,
              paymentLifecycle: {
                admitPaymentStart: mock(() => Effect.die("unused")),
                attachProviderSession: mock(() => Effect.die("unused")),
                markProviderStartFailed: mock(() => Effect.die("unused")),
                recordEvidenceConflict,
                markPaid,
                markTerminal,
              },
              reservations: {
                findById: mock(() => Effect.succeed(reservation as never)),
              } as unknown as WorkspaceReservationRepositoryType,
              nexi: {
                verifyPaymentOutcome: mock(() =>
                  Effect.succeed(providerVerification)
                ),
              } as unknown as NexiServiceType,
              fulfillment: { fulfillPaidOrder },
            },
            providerStatus === "success" ? payload : failurePayload
          )
        )
      );

      expect(result._tag).toBe("Failure");
      expect(markFailed).toHaveBeenCalledWith({
        type: "eventId",
        eventId: "event-id",
        errorCode: "nexi_webhook_transition_failed",
      });
      expect(markProcessed).not.toHaveBeenCalled();
      expect(fulfillPaidOrder).not.toHaveBeenCalled();
      expect(recordEvidenceConflict).toHaveBeenCalledWith({
        id: "attempt-id",
        workspaceReservationId: "reservation-id",
        conflictCodes: ["provider_terminal_state"],
      });
      if (providerStatus === "success") {
        expect(markPaid).toHaveBeenCalledTimes(1);
        expect(markTerminal).not.toHaveBeenCalled();
      } else {
        expect(markTerminal).toHaveBeenCalledTimes(1);
        expect(markPaid).not.toHaveBeenCalled();
      }
    });
  }

  test("keeps manual-review provider evidence failed and unprocessed", async () => {
    const markProcessed = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);
    const recordEvidenceConflict = mock(() => Effect.void);
    const markPaid = mock(() => Effect.die("unused"));
    const markTerminal = mock(() => Effect.die("unused"));

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
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            recordEvidenceConflict,
            markPaid,
            markTerminal,
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() =>
              Effect.succeed({
                ...verification,
                status: "manual_review",
                mismatches: ["operationEvidence"],
              })
            ),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_verification_mismatch",
    });
    expect(markProcessed).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
    expect(markTerminal).not.toHaveBeenCalled();
    expect(recordEvidenceConflict).toHaveBeenCalledWith({
      id: attempt.id,
      workspaceReservationId: attempt.workspaceReservationId,
      conflictCodes: ["provider_operation_evidence"],
    });
  });

  test("releases durable reconciliation ownership when provider lookup fails", async () => {
    const releaseProviderReconciliation = mock(() => Effect.void);
    const markFailed = mock(() => Effect.void);

    const result = await Effect.runPromise(
      Effect.result(
        await buildWebhookEffect({
          webhookEvents: {
            insertReceived: mock(() =>
              Effect.succeed({ status: "inserted", event: receivedEvent })
            ),
            linkPaymentAttempt: mock(() => Effect.void),
            markFailed,
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            releaseProviderReconciliation,
            recordEvidenceConflict: mock(() => Effect.die("unused")),
            markPaid: mock(() => Effect.die("unused")),
            markTerminal: mock(() => Effect.die("unused")),
          },
          reservations: {
            findById: mock(() => Effect.succeed(reservation as never)),
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() =>
              Effect.fail(new Error("provider lookup unavailable"))
            ),
          } as unknown as NexiServiceType,
          fulfillment: {
            fulfillPaidOrder: mock(() => Effect.die("unused")),
          },
        })
      )
    );

    expect(result._tag).toBe("Failure");
    expect(markFailed).toHaveBeenCalledWith({
      type: "eventId",
      eventId: "event-id",
      errorCode: "nexi_webhook_verification_failed",
    });
    expect(releaseProviderReconciliation).toHaveBeenCalledWith({
      id: attempt.id,
      workspaceReservationId: reservation.id,
      claimId: "claim-id",
    });
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
          } as unknown as WebhookEventRepositoryType,
          paymentAttempts: {
            findByProviderOrderId: mock(() => Effect.succeed(attempt)),
          } as unknown as PaymentAttemptRepositoryType,
          paymentLifecycle: {
            admitPaymentStart: mock(() => Effect.die("unused")),
            attachProviderSession: mock(() => Effect.die("unused")),
            markProviderStartFailed: mock(() => Effect.die("unused")),
            recordEvidenceConflict: mock(() => Effect.void),
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
          } as unknown as WorkspaceReservationRepositoryType,
          nexi: {
            verifyPaymentOutcome: mock(() => Effect.succeed(verification)),
          } as unknown as NexiServiceType,
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
});
