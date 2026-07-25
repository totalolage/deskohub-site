import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type {
  NexiService as NexiServiceTag,
  PaymentVerificationResult,
} from "@deskohub/nexi";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationRepository as WorkspaceReservationRepositoryType } from "@/features/reservation/backend/workspace-reservation.repository";
import type { WorkspacePaidFulfillmentService as WorkspacePaidFulfillmentServiceType } from "../fulfillment/paid-fulfillment.service";
import type { PaymentAttemptRepository as PaymentAttemptRepositoryType } from "../repositories/payment-attempt.repository";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
  PaymentLifecycleStateError,
} from "../repositories/payment-lifecycle.repository";

type NexiServiceType = typeof NexiServiceTag.Service;

const paymentLifecycleLayer = (
  overrides: Partial<IPaymentLifecycleRepository> = {}
) =>
  Layer.succeed(PaymentLifecycleRepository, {
    admitPaymentStart: () => Effect.die("not used"),
    attachProviderSession: () => Effect.die("not used"),
    markProviderStartFailed: () => Effect.die("not used"),
    claimProviderReconciliation: () =>
      Effect.succeed({
        outcome: "claimed" as const,
        claimId: "claim-id",
        attempt: pendingAttempt,
      }),
    releaseProviderReconciliation: () => Effect.void,
    recordEvidenceConflict: () => Effect.void,
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
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Now.instant(),
  updatedAt: Temporal.Now.instant(),
};

const buildVerification = (
  status: PaymentVerificationResult["status"],
  includeOperationId = true
): PaymentVerificationResult => ({
  status,
  provider: {
    orderId: "provider-order-id",
    ...(includeOperationId ? { operationId: "operation-id" } : {}),
    amount: "35000",
    currency: "CZK",
    orderStatus: status === "failure" ? "DECLINED" : "EXECUTED",
    captureExecuted: status === "success",
  },
  mismatches: [],
});

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
      const verifyPaymentOutcome = mock(() =>
        Effect.succeed(buildVerification("success"))
      );
      const markPaid = mock(() =>
        Effect.succeed({
          attempt: { ...pendingAttempt, state: "paid" as const },
          changed: false,
          timestamp: Temporal.Now.instant(),
        })
      );
      const reservations = {
        findById: mock(() =>
          Effect.succeed({ ...paidNotStartedReservation, fulfillmentState })
        ),
      } as unknown as WorkspaceReservationRepositoryType;
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
                Layer.succeed(WorkspaceReservationRepository, reservations),
                Layer.succeed(WorkspacePaidFulfillmentService, fulfillment),
                Layer.succeed(PaymentAttemptRepository, {
                  findById: mock(() =>
                    Effect.succeed({
                      ...pendingAttempt,
                      state: "paid" as const,
                    })
                  ),
                } as unknown as PaymentAttemptRepositoryType),
                paymentLifecycleLayer({
                  markPaid,
                  releaseProviderReconciliation,
                }),
                Layer.succeed(PostHogEventService, {
                  capture: () => Effect.void,
                }),
                Layer.succeed(NexiService, {
                  verifyPaymentOutcome,
                } as unknown as NexiServiceType)
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
      expect(verifyPaymentOutcome).toHaveBeenCalledTimes(1);
      expect(markPaid).toHaveBeenCalledTimes(1);
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
    const verifyPaymentOutcome = mock(() =>
      Effect.succeed(buildVerification("success"))
    );
    const markPaid = mock(() =>
      Effect.succeed({
        attempt: { ...pendingAttempt, state: "paid" as const },
        changed: false,
        timestamp: Temporal.Now.instant(),
      })
    );
    const reservations = {
      findById: mock(() =>
        Effect.succeed({
          ...paidNotStartedReservation,
          fulfillmentState: "failed",
        })
      ),
    } as unknown as WorkspaceReservationRepositoryType;
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
              Layer.succeed(WorkspaceReservationRepository, reservations),
              Layer.succeed(WorkspacePaidFulfillmentService, fulfillment),
              Layer.succeed(PaymentAttemptRepository, {
                findById: mock(() =>
                  Effect.succeed({
                    ...pendingAttempt,
                    state: "paid" as const,
                  })
                ),
              } as unknown as PaymentAttemptRepositoryType),
              paymentLifecycleLayer({ markPaid }),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {
                verifyPaymentOutcome,
              } as unknown as NexiServiceType)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("paid");
    expect(fulfillPaidOrder).not.toHaveBeenCalled();
    expect(verifyPaymentOutcome).toHaveBeenCalledTimes(1);
    expect(markPaid).toHaveBeenCalledTimes(1);
  });

  for (const includeOperationId of [true, false]) {
    for (const direction of [
      "paid_after_failed",
      "terminal_after_paid",
    ] as const) {
      test(`reconciles ${direction} as manual review with provider operation id present=${includeOperationId}`, async () => {
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

        const providerStatus =
          direction === "paid_after_failed" ? "success" : "failure";
        const localState =
          direction === "paid_after_failed" ? "failed" : "paid";
        const markPaid = mock(() =>
          Effect.fail(
            new PaymentLifecycleStateError({
              operation: "markPaid",
              paymentAttemptId: pendingAttempt.id,
              message: "Opposing terminal provider evidence.",
              reason: "provider_evidence_conflict",
            })
          )
        );
        const markTerminal = mock(() =>
          Effect.fail(
            new PaymentLifecycleStateError({
              operation: "markTerminal",
              paymentAttemptId: pendingAttempt.id,
              message: "Opposing terminal provider evidence.",
              reason: "provider_evidence_conflict",
            })
          )
        );
        const recordEvidenceConflict = mock(() => Effect.void);
        const fulfillPaidOrder = mock(() => Effect.void);
        const verifyPaymentOutcome = mock(() =>
          Effect.succeed(buildVerification(providerStatus, includeOperationId))
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
                  Layer.succeed(WorkspaceReservationRepository, {
                    findById: mock(() =>
                      Effect.succeed({
                        ...paidNotStartedReservation,
                        paymentState: localState,
                      })
                    ),
                  } as unknown as WorkspaceReservationRepositoryType),
                  Layer.succeed(WorkspacePaidFulfillmentService, {
                    fulfillPaidOrder,
                  }),
                  Layer.succeed(PaymentAttemptRepository, {
                    findById: mock(() =>
                      Effect.succeed({
                        ...pendingAttempt,
                        state: localState,
                        failureCode:
                          localState === "failed"
                            ? "nexi_payment_failed"
                            : null,
                      })
                    ),
                  } as unknown as PaymentAttemptRepositoryType),
                  paymentLifecycleLayer({
                    recordEvidenceConflict,
                    markPaid,
                    markTerminal,
                  }),
                  Layer.succeed(PostHogEventService, {
                    capture: () => Effect.void,
                  }),
                  Layer.succeed(NexiService, {
                    verifyPaymentOutcome,
                  } as unknown as NexiServiceType)
                )
              )
            )
          ),
          Effect.runPromise
        );

        expect(result).toBe("manual_review");
        expect(verifyPaymentOutcome).toHaveBeenCalledTimes(1);
        expect(recordEvidenceConflict).toHaveBeenCalledWith({
          id: "attempt-id",
          workspaceReservationId: "reservation-id",
          conflictCodes: ["provider_terminal_state"],
        });
        expect(fulfillPaidOrder).not.toHaveBeenCalled();
        if (direction === "paid_after_failed") {
          expect(markPaid).toHaveBeenCalledTimes(1);
          expect(markTerminal).not.toHaveBeenCalled();
        } else {
          expect(markTerminal).toHaveBeenCalledTimes(1);
          expect(markPaid).not.toHaveBeenCalled();
        }
      });
    }
  }

  for (const scenario of [
    {
      verificationStatus: "success" as const,
      expected: "paid" as const,
      changed: true,
      conflict: false,
    },
    {
      verificationStatus: "success" as const,
      expected: "paid" as const,
      changed: false,
      conflict: false,
    },
    {
      verificationStatus: "success" as const,
      expected: "manual_review" as const,
      changed: false,
      conflict: true,
      conflictReason: "provider_evidence_conflict" as const,
    },
    {
      verificationStatus: "success" as const,
      expected: "manual_review" as const,
      changed: false,
      conflict: true,
      conflictReason: "state_conflict" as const,
    },
    {
      verificationStatus: "failure" as const,
      expected: "terminal" as const,
      changed: true,
      conflict: false,
    },
    {
      verificationStatus: "failure" as const,
      expected: "terminal" as const,
      changed: false,
      conflict: false,
    },
    {
      verificationStatus: "failure" as const,
      expected: "manual_review" as const,
      changed: false,
      conflict: true,
      conflictReason: "provider_evidence_conflict" as const,
    },
    {
      verificationStatus: "success" as const,
      expected: "manual_review" as const,
      changed: false,
      conflict: true,
      conflictReason: "provider_evidence_conflict" as const,
      includeOperationId: false,
    },
    {
      verificationStatus: "failure" as const,
      expected: "manual_review" as const,
      changed: false,
      conflict: true,
      conflictReason: "provider_evidence_conflict" as const,
      includeOperationId: false,
    },
    {
      verificationStatus: "manual_review" as const,
      expected: "verification_mismatch" as const,
      changed: false,
      conflict: false,
      mismatches: ["orderId", "amount", "currency"] as const,
    },
    {
      verificationStatus: "manual_review" as const,
      expected: "verification_mismatch" as const,
      changed: false,
      conflict: false,
      mismatches: ["operationEvidence"] as const,
    },
  ]) {
    test(`finalizes pending ${scenario.verificationStatus} provider payments when settlement changed=${scenario.changed}`, async () => {
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
        scenario.conflict && scenario.verificationStatus === "success"
          ? Effect.fail(
              new PaymentLifecycleStateError({
                operation: "markPaid",
                paymentAttemptId: pendingAttempt.id,
                message:
                  "The paid replay conflicts with recorded provider evidence.",
                reason:
                  "conflictReason" in scenario
                    ? scenario.conflictReason
                    : undefined,
              })
            )
          : Effect.succeed({
              attempt: { ...pendingAttempt, state: "paid" as const },
              changed: scenario.changed,
              timestamp: Temporal.Now.instant(),
            })
      );
      const markTerminalForReservation = mock(() =>
        scenario.conflict
          ? Effect.fail(
              new PaymentLifecycleStateError({
                operation: "markTerminal",
                paymentAttemptId: pendingAttempt.id,
                message:
                  "The terminal replay conflicts with the recorded lifecycle outcome.",
                reason:
                  "conflictReason" in scenario
                    ? scenario.conflictReason
                    : undefined,
              })
            )
          : Effect.succeed({
              attempt: {
                ...pendingAttempt,
                state: "failed" as const,
                failureCode: "nexi_payment_failed",
                lastProviderStatus: "DECLINED",
              },
              changed: scenario.changed,
              timestamp: Temporal.Now.instant(),
            })
      );
      const fulfillPaidOrder = mock(() => Effect.void);
      const recordEvidenceConflict = mock(() => Effect.void);
      const paymentAttempts = {
        findById: mock(() => Effect.succeed(pendingAttempt)),
        markPaidForReservation,
        markTerminalForReservation,
      } as unknown as PaymentAttemptRepositoryType;
      const reservations = {
        findById: mock(() => Effect.succeed(pendingReservation)),
      } as unknown as WorkspaceReservationRepositoryType;
      const nexi = {
        verifyPaymentOutcome: mock(() =>
          Effect.succeed({
            ...buildVerification(
              scenario.verificationStatus,
              !(
                "includeOperationId" in scenario &&
                scenario.includeOperationId === false
              )
            ),
            mismatches: "mismatches" in scenario ? scenario.mismatches : [],
          } as PaymentVerificationResult)
        ),
      } as unknown as NexiServiceType;

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
                Layer.succeed(WorkspaceReservationRepository, reservations),
                Layer.succeed(WorkspacePaidFulfillmentService, {
                  fulfillPaidOrder,
                }),
                Layer.succeed(PaymentAttemptRepository, paymentAttempts),
                paymentLifecycleLayer({
                  recordEvidenceConflict,
                  markPaid: markPaidForReservation,
                  markTerminal: markTerminalForReservation,
                }),
                Layer.succeed(PostHogEventService, {
                  capture: mock(() => Effect.void),
                }),
                Layer.succeed(NexiService, nexi)
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

      if (scenario.verificationStatus === "success") {
        expect(markPaidForReservation).toHaveBeenCalledWith(
          expect.objectContaining({
            id: "attempt-id",
            workspaceReservationId: "reservation-id",
            webhookEventId: "event-id",
          })
        );
        if (scenario.conflict) {
          expect(fulfillPaidOrder).not.toHaveBeenCalled();
          if (
            "conflictReason" in scenario &&
            scenario.conflictReason === "provider_evidence_conflict"
          ) {
            expect(recordEvidenceConflict).toHaveBeenCalledWith({
              id: "attempt-id",
              workspaceReservationId: "reservation-id",
              conflictCodes: ["provider_terminal_state"],
            });
          }
        } else {
          expect(fulfillPaidOrder).toHaveBeenCalledWith({
            orderId: "reservation-id",
          });
        }
        expect(markTerminalForReservation).not.toHaveBeenCalled();
      } else if (scenario.verificationStatus === "failure") {
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
        if (scenario.conflict) {
          expect(recordEvidenceConflict).toHaveBeenCalledWith({
            id: "attempt-id",
            workspaceReservationId: "reservation-id",
            conflictCodes: ["provider_terminal_state"],
          });
        }
      } else {
        expect(markPaidForReservation).not.toHaveBeenCalled();
        expect(markTerminalForReservation).not.toHaveBeenCalled();
        expect(fulfillPaidOrder).not.toHaveBeenCalled();
        expect(recordEvidenceConflict).toHaveBeenCalledWith({
          id: "attempt-id",
          workspaceReservationId: "reservation-id",
          conflictCodes:
            "mismatches" in scenario &&
            scenario.mismatches.some(
              (mismatch) => mismatch === "operationEvidence"
            )
              ? ["provider_operation_evidence"]
              : [
                  "provider_order_identity",
                  "provider_amount",
                  "provider_currency",
                ],
        });
      }
    });
  }

  test("verifies an unattached created attempt by stable provider order identity", async () => {
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

    const verifyPaymentOutcome = mock(() =>
      Effect.succeed(buildVerification("pending"))
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
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.succeed(PaymentAttemptRepository, {
                findById: mock(() =>
                  Effect.succeed({ ...pendingAttempt, securityToken: null })
                ),
              } as unknown as PaymentAttemptRepositoryType),
              paymentLifecycleLayer(),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {
                verifyPaymentOutcome,
              } as unknown as NexiServiceType)
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBe("pending");
    expect(verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
      amount: "35000",
      currency: "EUR",
    });
  });

  test("does not settle or fulfill incomplete authoritative terminal evidence", async () => {
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

    for (const providerStatus of ["EXECUTED", "DECLINED"] as const) {
      const markPaid = mock(() => Effect.die("must not mark paid"));
      const markTerminal = mock(() => Effect.die("must not mark terminal"));
      const fulfillPaidOrder = mock(() => Effect.die("must not fulfill"));
      const verifyPaymentOutcome = mock(() =>
        Effect.succeed({
          status: "pending" as const,
          provider: {
            orderId: "provider-order-id",
            orderStatus: providerStatus,
            captureExecuted: false,
          },
          mismatches: [],
        })
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
                Layer.succeed(WorkspaceReservationRepository, {
                  findById: mock(() => Effect.succeed(pendingReservation)),
                } as unknown as WorkspaceReservationRepositoryType),
                Layer.succeed(WorkspacePaidFulfillmentService, {
                  fulfillPaidOrder,
                }),
                Layer.succeed(PaymentAttemptRepository, {
                  findById: mock(() => Effect.succeed(pendingAttempt)),
                } as unknown as PaymentAttemptRepositoryType),
                paymentLifecycleLayer({ markPaid, markTerminal }),
                Layer.succeed(PostHogEventService, {
                  capture: () => Effect.void,
                }),
                Layer.succeed(NexiService, {
                  verifyPaymentOutcome,
                } as unknown as NexiServiceType)
              )
            )
          )
        ),
        Effect.runPromise
      );

      expect(result).toBe("pending");
      expect(markPaid).not.toHaveBeenCalled();
      expect(markTerminal).not.toHaveBeenCalled();
      expect(fulfillPaidOrder).not.toHaveBeenCalled();
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
    const releaseProviderReconciliation = mock(() => Effect.void);

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
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.succeed(PaymentAttemptRepository, {
                findById: mock(() => Effect.succeed(pendingAttempt)),
              } as unknown as PaymentAttemptRepositoryType),
              paymentLifecycleLayer({
                markPaid: mock(() => Effect.fail(persistenceFailure)),
                releaseProviderReconciliation,
              }),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {
                verifyPaymentOutcome: mock(() =>
                  Effect.succeed(buildVerification("success"))
                ),
              } as unknown as NexiServiceType)
            )
          )
        )
      ),
      Effect.result,
      Effect.runPromise
    );

    expect(result).toMatchObject({ failure: persistenceFailure });
    expect(releaseProviderReconciliation).toHaveBeenCalledWith({
      id: pendingAttempt.id,
      workspaceReservationId: pendingAttempt.workspaceReservationId,
      claimId: "claim-id",
    });
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
              Layer.succeed(WorkspaceReservationRepository, {
                findById: mock(() => Effect.succeed(pendingReservation)),
              } as unknown as WorkspaceReservationRepositoryType),
              Layer.succeed(WorkspacePaidFulfillmentService, {
                fulfillPaidOrder: mock(() => Effect.void),
              }),
              Layer.succeed(PaymentAttemptRepository, {
                findById: mock(() => Effect.succeed(pendingAttempt)),
              } as unknown as PaymentAttemptRepositoryType),
              paymentLifecycleLayer({
                markPaid: markPaidForReservation,
                markTerminal: markTerminalForReservation,
              }),
              Layer.succeed(PostHogEventService, {
                capture: () => Effect.void,
              }),
              Layer.succeed(NexiService, {
                verifyPaymentOutcome,
              } as unknown as NexiServiceType)
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
