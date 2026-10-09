import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import {
  type GetNexiOrderInput,
  NexiCorrelationIdSchema,
  NexiOperationIdSchema,
  type NexiOrder,
  NexiOrderIdSchema,
  type NexiService as NexiServiceTag,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import type { NexiPaymentAttempt } from "../repositories/payment-attempt.repository";
import type {
  IPaymentRefundRepository,
  RefundablePaymentAttempt,
} from "../repositories/payment-refund.repository";

const providerOrderId = NexiOrderIdSchema.make("provider-order-id");

const attempt: NexiPaymentAttempt = {
  id: paymentAttemptIdSchema.make("attempt-id"),
  workspaceReservationId: workspaceReservationIdSchema.make("reservation-id"),
  provider: "nexi",
  providerOrderId,
  state: "paid",
  refundState: "required",
  refundedAmountValue: null,
  refundedAt: null,
  amount: { value: 35_000, exponent: 2, currency: "CZK" },
  securityToken: "security-token",
  providerRedirectUrl: "https://provider.example/pay",
  providerOrderCreatedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  createdAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
  updatedAt: Temporal.Instant.from("2026-10-01T10:00:00Z"),
};

const candidate: RefundablePaymentAttempt = {
  attempt,
  correlationId: NexiCorrelationIdSchema.make("correlation-id"),
};

const refundedOrder: NexiOrder = {
  orderId: providerOrderId,
  operations: [
    {
      operationType: "CAPTURE",
      operationResult: "EXECUTED",
      amount: "35000",
    },
    {
      operationId: NexiOperationIdSchema.make("refund-operation-id"),
      operationType: "REFUND",
      // Back-office refunds before settlement are reported as VOIDED.
      operationResult: "VOIDED",
      operationTime: "2026-10-05T08:30:00Z",
      amount: "35000",
    },
  ],
};

const unusedRepositoryCall = () => Effect.die("unused");

const buildService = async (services: {
  readonly getOrder: (typeof NexiServiceTag.Service)["getOrder"];
  readonly recordRefund?: IPaymentRefundRepository["recordRefund"];
  readonly claimAwaitingRefund?: IPaymentRefundRepository["claimAwaitingRefund"];
}) => {
  const { NexiService } = await import("@deskohub/nexi");
  const { PaymentRefundRepository } = await import(
    "../repositories/payment-refund.repository"
  );
  const { PaymentRefundService } = await import("./payment-refund.service");

  const layer = PaymentRefundService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(NexiService, { getOrder: services.getOrder }),
        Layer.mock(PaymentRefundRepository, {
          recordRefund: services.recordRefund ?? unusedRepositoryCall,
          claimAwaitingRefund:
            services.claimAwaitingRefund ?? unusedRepositoryCall,
        })
      )
    )
  );

  return <A, E>(
    use: (service: typeof PaymentRefundService.Service) => Effect.Effect<A, E>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* PaymentRefundService);
      }).pipe(Effect.provide(layer))
    );
};

describe("PaymentRefundService", () => {
  test("records the refund total and time Nexi reports for the order", async () => {
    const getOrder = mock(() => Effect.succeed(refundedOrder));
    const recordRefund = mock(() => Effect.succeed("recorded" as const));
    const run = await buildService({ getOrder, recordRefund });

    const result = await run((service) => service.reconcileAttempt(candidate));

    expect(result).toBe("recorded");
    expect(getOrder).toHaveBeenCalledWith({
      orderId: "provider-order-id",
      correlationId: "correlation-id",
    });
    expect(recordRefund).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "attempt-id",
        refundedAmountValue: 35_000,
        refundedAt: Temporal.Instant.from("2026-10-05T08:30:00Z"),
      })
    );
  });

  test("leaves the attempt untouched while Nexi shows no successful refund", async () => {
    const recordRefund = mock(() => Effect.die("not used"));
    const run = await buildService({
      getOrder: () =>
        Effect.succeed({
          ...refundedOrder,
          operations: [
            {
              operationType: "REFUND",
              operationResult: "PENDING",
              amount: "35000",
            },
          ],
        }),
      recordRefund,
    });

    const result = await run((service) => service.reconcileAttempt(candidate));

    expect(result).toBe("no_refund");
    expect(recordRefund).not.toHaveBeenCalled();
  });

  test("keeps reconciling the batch when one provider lookup fails", async () => {
    const recordRefund = mock(() => Effect.succeed("recorded" as const));
    const claimAwaitingRefund = mock(() =>
      Effect.succeed([
        candidate,
        {
          ...candidate,
          attempt: {
            ...attempt,
            id: paymentAttemptIdSchema.make("failing-attempt-id"),
            providerOrderId: NexiOrderIdSchema.make("failing-order-id"),
          },
        },
      ])
    );
    const run = await buildService({
      claimAwaitingRefund,
      getOrder: (input: GetNexiOrderInput) =>
        input.orderId === "failing-order-id"
          ? Effect.fail(new Error("provider unavailable"))
          : Effect.succeed(refundedOrder),
      recordRefund,
    });

    const summary = await run((service) =>
      service.reconcileAwaitingRefunds({ limit: 25 })
    );

    expect(summary).toEqual({ checked: 2, recorded: 1, failed: 1 });
    expect(recordRefund).toHaveBeenCalledTimes(1);
    expect(claimAwaitingRefund).toHaveBeenCalledWith({
      limit: 25,
      checkedAt: expect.any(Temporal.Instant),
    });
  });
});
