import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import type { WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType } from "../fulfillment/paid-fulfillment.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "../repositories/payment-lifecycle.repository";

type NexiServiceType = typeof NexiServiceTag.Service;

const paymentLifecycleLayer = (
  overrides: Partial<IPaymentLifecycleRepository> = {}
) =>
  Layer.mock(PaymentLifecycleRepository, {
    createPendingNexiAttempt: () => Effect.die("not used"),
    attachProviderSession: () => Effect.die("not used"),
    markPaid: () => Effect.die("not used"),
    markTerminal: () => Effect.die("not used"),
    ...overrides,
  });

const paidNotStartedReservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
  paymentState: "paid",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-id",
};

const pendingReservation = {
  ...paidNotStartedReservation,
  paymentState: "pending",
};

const pendingAttempt = {
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

const buildVerification = (
  status: PaymentVerificationResult["status"]
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
  },
  mismatches: [],
});

const emptyPendingVerification: PaymentVerificationResult = {
  status: "pending",
  provider: {
    orderId: "provider-order-id",
    operationCount: 0,
    amount: "35000",
    currency: "CZK",
    authorizedAmount: "0",
    capturedAmount: "0.00",
    orderStatus: "PENDING",
    captureExecuted: false,
  },
  mismatches: [],
};

describe("ProviderPaymentFinalizationService", () => {
  for (const fulfillmentState of ["not_started", "processing"] as const) {
    test(`starts fulfillment for already-paid ${fulfillmentState} provider returns`, async () => {
      const {
        ProviderPaymentFinalizationService,
        ProviderPaymentFinalizationServiceLive,
      } = await import("./provider-payment-finalization.service");
      const { PaymentAttemptRepository } = await import(
        "../repositories/payment-attempt.repository"
      );
      const { WorkspacePaidFulfillmentService } = await import(
        "../fulfillment/paid-fulfillment.service"
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const { PostHogEventService } = await import(
        "@/shared/backend/analytics/posthog-event.service"
      );
      const { NexiService } = await import("@deskohub/nexi");

      const fulfillPaidOrder = mock(() => Effect.void);
      const reservations = {
        findById: mock(() =>
          Effect.succeed({ ...paidNotStartedReservation, fulfillmentState })
        ),
      };
      const fulfillment: WorkspacePaidFulfillmentServiceType = {
        fulfillPaidOrder,
      };

      const result = await Effect.gen(function* () {
        const service = yield* ProviderPaymentFinalizationService;
        return yield* service.finalizePendingProviderPayment({
          orderId: "reservation-id",
          paymentAttemptId: "attempt-id",
        });
      }).pipe(
        Effect.provide(
          ProviderPaymentFinalizationServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(WorkspaceReservationRepository, reservations),
                Layer.mock(WorkspacePaidFulfillmentService, fulfillment),
                Layer.mock(
                  PaymentAttemptRepository,
                  {} as PaymentAttemptRepositoryType
                ),
                paymentLifecycleLayer(),
                Layer.mock(PostHogEventService, {
                  capture: () => Effect.void,
                }),
                Layer.mock(NexiService, {} as NexiServiceType)
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result).toBe("paid");
      expect(fulfillPaidOrder).toHaveBeenCalledWith({
        orderId: "reservation-id",
      });
    });
  }

  test("does not retry fulfillment after a paid reservation has failed fulfillment", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const fulfillPaidOrder = mock(() => Effect.void);
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          ...paidNotStartedReservation,
          fulfillmentState: "failed",
        })
      ),
    };
    const fulfillment: WorkspacePaidFulfillmentServiceType = {
      fulfillPaidOrder,
    };

    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, reservations),
              Layer.mock(WorkspacePaidFulfillmentService, fulfillment),
              Layer.mock(
                PaymentAttemptRepository,
                {} as PaymentAttemptRepositoryType
              ),
              paymentLifecycleLayer(),
              Layer.mock(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.mock(NexiService, {} as NexiServiceType)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("not_pending");
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
  });

  for (const scenario of [
    { verificationStatus: "success" as const, expected: "paid" as const },
    { verificationStatus: "failure" as const, expected: "terminal" as const },
  ]) {
    test(`finalizes pending ${scenario.verificationStatus} provider payments`, async () => {
      const {
        ProviderPaymentFinalizationService,
        ProviderPaymentFinalizationServiceLive,
      } = await import("./provider-payment-finalization.service");
      const { PaymentAttemptRepository } = await import(
        "../repositories/payment-attempt.repository"
      );
      const { WorkspacePaidFulfillmentService } = await import(
        "../fulfillment/paid-fulfillment.service"
      );
      const { WorkspaceReservationRepository } = await import(
        "@/features/reservation/backend/workspace-reservation.repository"
      );
      const { PostHogEventService } = await import(
        "@/shared/backend/analytics/posthog-event.service"
      );
      const { NexiService } = await import("@deskohub/nexi");

      const markPaidForReservation = mock(() =>
        Effect.succeed({
          attempt: { ...pendingAttempt, state: "paid" as const },
          changed: true,
          timestamp: Temporal.Now.instant(),
        })
      );
      const markTerminalForReservation = mock(() =>
        Effect.succeed({
          attempt: {
            ...pendingAttempt,
            state: "failed" as const,
            failureCode: "nexi_payment_failed",
            lastProviderStatus: "DECLINED",
          },
          changed: true,
          timestamp: Temporal.Now.instant(),
        })
      );
      const fulfillPaidOrder = mock(() => Effect.void);
      const paymentAttempts = {
        findById: mock(() => Effect.succeed(pendingAttempt)),
        markPaidForReservation,
        markTerminalForReservation,
      };
      const reservations = {
        findById: mock(() => Effect.succeed(pendingReservation)),
      };
      const nexi = {
        verifyPaymentOutcome: mock(() =>
          Effect.succeed(buildVerification(scenario.verificationStatus))
        ),
      };

      const result = await Effect.gen(function* () {
        const service = yield* ProviderPaymentFinalizationService;
        return yield* service.finalizePendingProviderPayment({
          orderId: "reservation-id",
          paymentAttemptId: "attempt-id",
          webhookEventId: "event-id",
        });
      }).pipe(
        Effect.provide(
          ProviderPaymentFinalizationServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(WorkspaceReservationRepository, reservations),
                Layer.mock(WorkspacePaidFulfillmentService, {
                  fulfillPaidOrder,
                }),
                Layer.mock(PaymentAttemptRepository, paymentAttempts),
                paymentLifecycleLayer({
                  markPaid: markPaidForReservation,
                  markTerminal: markTerminalForReservation,
                }),
                Layer.mock(PostHogEventService, {
                  capture: mock(() => Effect.void),
                }),
                Layer.mock(NexiService, nexi)
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result).toBe(scenario.expected);
      expect(nexi.verifyPaymentOutcome).toHaveBeenCalledWith({
        orderId: "provider-order-id",
        correlationId: "correlation-id",
        amount: "35000",
        currency: "EUR",
        securityToken: "security-token",
      });

      if (scenario.expected === "paid") {
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
        expect(markTerminalForReservation).not.toHaveBeenCalled();
      } else {
        expect(markTerminalForReservation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "attempt-id",
            workspaceReservationId: "reservation-id",
            state: "failed",
            failureCode: "nexi_payment_failed",
            webhookEventId: "event-id",
          })
        );
        expect(markPaidForReservation).not.toHaveBeenCalled();
        expect(fulfillPaidOrder).not.toHaveBeenCalled();
      }
    });
  }

  test("returns not_verifiable for pending attempts missing local verification data", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const verifyPaymentOutcome = mock(() => Effect.die("not used"));
    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              }),
              Layer.mock(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.mock(PaymentAttemptRepository, {
                findById: mock(() =>
                  Effect.succeed({ ...pendingAttempt, securityToken: null })
                ),
              }),
              paymentLifecycleLayer(),
              Layer.mock(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.mock(NexiService, {
                verifyPaymentOutcome,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("not_verifiable");
    expect(verifyPaymentOutcome).not.toHaveBeenCalled();
  });

  test("defers empty orders until the cutoff and abandons only operation-free zero-value orders", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const providerOrderCreatedAt = pendingAttempt.providerOrderCreatedAt;
    const scenarios = [
      {
        name: "before cutoff",
        checkedAt: providerOrderCreatedAt.add({ minutes: 29, seconds: 59 }),
        verification: emptyPendingVerification,
        expected: "deferred",
      },
      {
        name: "at cutoff",
        checkedAt: providerOrderCreatedAt.add({ minutes: 30 }),
        verification: emptyPendingVerification,
        expected: "abandoned",
      },
      {
        name: "with an operation",
        checkedAt: providerOrderCreatedAt.add({ hours: 1 }),
        verification: {
          ...emptyPendingVerification,
          provider: {
            ...emptyPendingVerification.provider,
            operationCount: 1,
          },
        },
        expected: "pending",
      },
      {
        name: "with an authorized amount",
        checkedAt: providerOrderCreatedAt.add({ hours: 1 }),
        verification: {
          ...emptyPendingVerification,
          provider: {
            ...emptyPendingVerification.provider,
            authorizedAmount: "1",
          },
        },
        expected: "pending",
      },
    ] as const;

    for (const scenario of scenarios) {
      const result = await Effect.gen(function* () {
        const service = yield* ProviderPaymentFinalizationService;
        return yield* service.finalizePendingProviderPayment({
          orderId: "reservation-id",
          paymentAttemptId: "attempt-id",
          abandonmentCheckedAt: scenario.checkedAt,
        });
      }).pipe(
        Effect.provide(
          ProviderPaymentFinalizationServiceLive.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.mock(WorkspaceReservationRepository, {
                  findById: mock(() => Effect.succeed(pendingReservation)),
                }),
                Layer.mock(WorkspacePaidFulfillmentService, {
                  fulfillPaidOrder: mock(() => Effect.die("not used")),
                }),
                Layer.mock(PaymentAttemptRepository, {
                  findById: mock(() => Effect.succeed(pendingAttempt)),
                }),
                paymentLifecycleLayer(),
                Layer.mock(PostHogEventService, {
                  capture: () => Effect.void,
                }),
                Layer.mock(NexiService, {
                  verifyPaymentOutcome: mock(() =>
                    Effect.succeed(scenario.verification)
                  ),
                })
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result, scenario.name).toBe(scenario.expected);
    }
  });

  test("propagates lifecycle persistence failures instead of returning not_pending", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");
    const persistenceFailure = new EffectDrizzleQueryError({
      query: "payment lifecycle paid transition",
      params: [],
      cause: "database unavailable",
    });

    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              }),
              Layer.mock(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.mock(PaymentAttemptRepository, {
                findById: mock(() => Effect.succeed(pendingAttempt)),
              }),
              paymentLifecycleLayer({
                markPaid: mock(() => Effect.fail(persistenceFailure)),
              }),
              Layer.mock(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.mock(NexiService, {
                verifyPaymentOutcome: mock(() =>
                  Effect.succeed(buildVerification("success"))
                ),
              })
            )
          )
        )
      ),
      Effect.result,
      Effect.runPromise
    );

    expect(result).toMatchObject({ failure: persistenceFailure });
  });

  test("returns provider_verification_failed when Nexi verification errors", async () => {
    const {
      ProviderPaymentFinalizationService,
      ProviderPaymentFinalizationServiceLive,
    } = await import("./provider-payment-finalization.service");
    const { PaymentAttemptRepository } = await import(
      "../repositories/payment-attempt.repository"
    );
    const { WorkspacePaidFulfillmentService } = await import(
      "../fulfillment/paid-fulfillment.service"
    );
    const { WorkspaceReservationRepository } = await import(
      "@/features/reservation/backend/workspace-reservation.repository"
    );
    const { PostHogEventService } = await import(
      "@/shared/backend/analytics/posthog-event.service"
    );
    const { NexiService } = await import("@deskohub/nexi");

    const markPaidForReservation = mock(() => Effect.die("not used"));
    const markTerminalForReservation = mock(() => Effect.die("not used"));
    const verifyPaymentOutcome = mock(() =>
      Effect.fail(
        new EffectDrizzleQueryError({
          query: "nexi.verifyPaymentOutcome",
          params: [],
          cause: "nexi down",
        })
      )
    );

    const result = await Effect.gen(function* () {
      const service = yield* ProviderPaymentFinalizationService;
      return yield* service.finalizePendingProviderPayment({
        orderId: "reservation-id",
        paymentAttemptId: "attempt-id",
      });
    }).pipe(
      Effect.provide(
        ProviderPaymentFinalizationServiceLive.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              }),
              Layer.mock(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.mock(PaymentAttemptRepository, {
                findById: mock(() => Effect.succeed(pendingAttempt)),
              }),
              paymentLifecycleLayer({
                markPaid: markPaidForReservation,
                markTerminal: markTerminalForReservation,
              }),
              Layer.mock(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.mock(NexiService, {
                verifyPaymentOutcome,
              })
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("provider_verification_failed");
    expect(verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
      amount: "35000",
      currency: "EUR",
      securityToken: "security-token",
    });
    expect(markPaidForReservation).not.toHaveBeenCalled();
    expect(markTerminalForReservation).not.toHaveBeenCalled();
  });
});
