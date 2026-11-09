import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { NexiService, type PaymentVerificationResult } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { LatePaymentRecoveryRepository } from "../repositories/late-payment-recovery.repository";
import { PaymentAttemptRepository } from "../repositories/payment-attempt.repository";
import { LatePaymentRecoveryQueueService } from "./late-payment-recovery-queue.service";
import { LatePaymentVerificationService } from "./late-payment-verification.service";

const expiredReservation = {
  id: "reservation-id",
  correlationId: "correlation-id",
  paymentState: "expired",
  fulfillmentState: "not_started",
  activePaymentAttemptId: "attempt-id",
};

const expiredAttempt = {
  id: "attempt-id",
  workspaceReservationId: "reservation-id",
  provider: "nexi" as const,
  providerOrderId: "provider-order-id",
  state: "expired" as const,
  amount: { value: 29_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
};

const verification = (
  status: PaymentVerificationResult["status"],
  mismatches: PaymentVerificationResult["mismatches"] = []
): PaymentVerificationResult => ({
  status,
  provider: {
    orderId: "provider-order-id",
    operationId: "operation-id",
    operationCount: 1,
    amount: "29000",
    currency: "CZK",
    orderStatus: status === "success" ? "EXECUTED" : "DECLINED",
    captureExecuted: status === "success",
  },
  mismatches,
});

const makeHarness = (options: {
  readonly reservation?: { readonly paymentState: string };
  readonly existingRecovery?: { readonly state: string };
  readonly verification?: PaymentVerificationResult;
}) => {
  const spies = {
    start: mock(() => Effect.succeed({} as never)),
    enqueue: mock(() => Effect.void),
    verifyPaymentOutcome: mock(() =>
      Effect.succeed(options.verification ?? verification("success"))
    ),
  };
  const layer = LatePaymentVerificationService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(WorkspaceReservationRepository, {
          findById: mock(() =>
            Effect.succeed({
              ...expiredReservation,
              ...options.reservation,
            } as never)
          ),
        }),
        Layer.mock(PaymentAttemptRepository, {
          findById: mock(() => Effect.succeed(expiredAttempt as never)),
        }),
        Layer.mock(LatePaymentRecoveryRepository, {
          findByPaymentAttemptId: mock(() =>
            Effect.succeed(
              (options.existingRecovery
                ? {
                    ...options.existingRecovery,
                    createdAt: Temporal.Now.instant(),
                  }
                : null) as never
            )
          ),
          start: spies.start,
        }),
        Layer.mock(LatePaymentRecoveryQueueService, {
          enqueue: spies.enqueue,
        }),
        Layer.mock(NexiService, {
          verifyPaymentOutcome: spies.verifyPaymentOutcome as never,
        })
      )
    )
  );
  const run = () =>
    Effect.gen(function* () {
      const service = yield* LatePaymentVerificationService;
      return yield* service.startRecoveryIfSettled({
        orderId: "reservation-id" as never,
      });
    }).pipe(Effect.provide(layer), Effect.runPromise);
  return { run, spies };
};

describe("LatePaymentVerificationService", () => {
  test("starts recovery when Nexi reports a locally expired attempt as paid", async () => {
    const harness = makeHarness({});

    const result = await harness.run();

    expect(result).toBe("recovery_started");
    expect(harness.spies.verifyPaymentOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: "provider-order-id",
        correlationId: "correlation-id",
        amount: "29000",
        securityToken: "security-token",
      })
    );
    expect(harness.spies.start).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAttemptId: "attempt-id",
        workspaceReservationId: "reservation-id",
        providerOperationId: "operation-id",
        providerStatus: "EXECUTED",
      })
    );
    expect(harness.spies.start.mock.calls[0]?.[0]).not.toHaveProperty(
      "webhookEventId"
    );
    expect(harness.spies.enqueue).toHaveBeenCalledWith({
      paymentAttemptId: "attempt-id",
    });
  });

  test("leaves an unpaid terminal attempt alone", async () => {
    const harness = makeHarness({ verification: verification("failure") });

    expect(await harness.run()).toBe("not_settled");
    expect(harness.spies.start).not.toHaveBeenCalled();
    expect(harness.spies.enqueue).not.toHaveBeenCalled();
  });

  test("does not start recovery from a mismatching provider verification", async () => {
    const harness = makeHarness({
      verification: verification("success", ["amount"]),
    });

    expect(await harness.run()).toBe("verification_mismatch");
    expect(harness.spies.start).not.toHaveBeenCalled();
  });

  test("does not query Nexi again once recovery has started", async () => {
    const harness = makeHarness({ existingRecovery: { state: "processing" } });

    expect(await harness.run()).toBe("recovery_started");
    expect(harness.spies.verifyPaymentOutcome).not.toHaveBeenCalled();
    expect(harness.spies.start).not.toHaveBeenCalled();
  });

  for (const paymentState of ["not_started", "pending", "paid"]) {
    test(`ignores a ${paymentState} reservation`, async () => {
      const harness = makeHarness({ reservation: { paymentState } });

      expect(await harness.run()).toBe("not_applicable");
      expect(harness.spies.verifyPaymentOutcome).not.toHaveBeenCalled();
    });
  }
});
