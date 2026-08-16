import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { NexiService } from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import type { AccountingDocumentSnapshot } from "@/features/accounting/accounting-document-snapshot";
import { orderIdSchema } from "@/features/order";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import {
  type IPaymentLifecycleRepository,
  PaymentLifecycleRepository,
} from "../repositories/payment-lifecycle.repository";
import { OrderPaymentSessionService } from "./order-payment-session.service";

const orderId = orderIdSchema.make("goods-order-1");
const amount = { value: 12_500, exponent: 2, currency: "CZK" };
const now = Temporal.Instant.from("2026-08-16T12:00:00Z");
const attempt = {
  id: "attempt-1",
  orderId,
  workspaceReservationId: null,
  provider: "nexi" as const,
  providerOrderId: "DPROVIDERORDER",
  state: "created" as const,
  refundState: "not_required" as const,
  securityToken: null,
  providerRedirectUrl: null,
  providerOrderCreatedAt: null,
  lastWebhookEventId: null,
  lastProviderOperationId: null,
  lastProviderStatus: null,
  failureCode: null,
  amount,
  createdAt: now,
  updatedAt: now,
};
const callbacks = {
  notificationUrl: "https://example.test/webhook",
  resultUrl: "https://example.test/return",
  cancelUrl: "https://example.test/cancel",
};
const input = {
  orderId,
  locale: "en-US" as const,
  amount,
  accountingSnapshot: {} as AccountingDocumentSnapshot,
  payer: {
    id: "customer-1",
    name: "Synthetic Customer",
    email: "synthetic@example.test",
  },
  callbacks,
  evidence: { mode: "order_evidence_committed" as const },
};

const run = async (
  admitPaymentSession: IPaymentLifecycleRepository["admitPaymentSession"],
  overrides: Partial<typeof input> = {}
) => {
  const createHostedPaymentPage = mock(() =>
    Effect.succeed({
      securityToken: "security-token",
      hostedPage: "https://provider.example/pay",
    })
  );
  const attachProviderSession = mock(() =>
    Effect.succeed({
      ...attempt,
      state: "pending" as const,
      securityToken: "security-token",
      providerRedirectUrl: "https://provider.example/pay",
    })
  );
  const capture = mock(() => Effect.void);
  const result = await Effect.gen(function* () {
    const service = yield* OrderPaymentSessionService;
    return yield* service.startOrResume({ ...input, ...overrides });
  }).pipe(
    Effect.provide(
      OrderPaymentSessionService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(PaymentLifecycleRepository, {
              admitPaymentSession,
              attachProviderSession,
              markTerminal: () => Effect.die("not used"),
            }),
            Layer.mock(NexiService, { createHostedPaymentPage }),
            Layer.mock(PostHogEventService, { capture })
          )
        )
      )
    ),
    Effect.runPromise
  );
  return { result, createHostedPaymentPage, attachProviderSession, capture };
};

describe("OrderPaymentSessionService", () => {
  test("resumes the exact active provider attempt without creating another", async () => {
    const scenario = await run(() =>
      Effect.succeed({
        status: "resume",
        attempt: {
          ...attempt,
          state: "pending",
          securityToken: "security-token",
          providerRedirectUrl: "https://provider.example/existing",
        },
      })
    );

    expect(scenario.result).toMatchObject({
      status: "redirect",
      redirectUrl: "https://provider.example/existing",
    });
    expect(scenario.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("returns the oldest outstanding goods order without calling Nexi", async () => {
    const outstandingOrderId = orderIdSchema.make("goods-order-oldest");
    const scenario = await run(() =>
      Effect.succeed({
        status: "outstanding_order",
        orderId: outstandingOrderId,
      })
    );

    expect(scenario.result).toEqual({
      status: "outstanding_order",
      orderId: outstandingOrderId,
    });
    expect(scenario.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("completes zero-total admission internally and does not call Nexi", async () => {
    const internalAttempt = {
      ...attempt,
      provider: "internal" as const,
      providerOrderId: null,
      state: "paid" as const,
      amount: { ...amount, value: 0 },
    };
    const admitPaymentSession = mock((admissionInput) => {
      expect(admissionInput.providerOrderId).toBeUndefined();
      return Effect.succeed({
        status: "paid" as const,
        attempt: internalAttempt,
        changed: true,
      });
    });
    const scenario = await run(admitPaymentSession, {
      amount: { ...amount, value: 0 },
    });

    expect(scenario.result).toMatchObject({ status: "paid", changed: true });
    expect(scenario.createHostedPaymentPage).not.toHaveBeenCalled();
    expect(scenario.capture).toHaveBeenCalledTimes(1);
  });

  test("admits one attempt while a concurrent retry remains in progress", async () => {
    let admissions = 0;
    const admitPaymentSession = mock(() => {
      admissions += 1;
      return Effect.succeed(
        admissions === 1
          ? {
              status: "created" as const,
              attempt,
              correlationId: "correlation-1" as never,
            }
          : { status: "in_progress" as const }
      );
    });
    const scenario = await run(admitPaymentSession);
    const retry = await run(admitPaymentSession);

    expect(scenario.result.status).toBe("redirect");
    expect(retry.result).toEqual({ status: "in_progress" });
    expect(scenario.createHostedPaymentPage).toHaveBeenCalledTimes(1);
    expect(retry.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("keeps admission, debt selection, and evidence mode under the order lock", async () => {
    const source = await Bun.file(
      new URL(
        "../repositories/payment-lifecycle.repository.ts",
        import.meta.url
      )
    ).text();
    const start = source.indexOf("const admitPaymentSession = Effect.fn(");
    const end = source.indexOf("const createPendingNexiAttempt", start);
    const admission = source.slice(start, end);

    expect(admission).toContain(".transaction");
    expect(admission).toContain('.for("update")');
    expect(admission).toContain('eq(orders.kind, "goods")');
    expect(admission).toContain("asc(orders.createdAt)");
    expect(admission).toContain('mode === "reservation_attempt_commitment"');
    expect(admission).not.toContain("persistIssuedGoodsDiscountEvidence");
  });

  test("resolves newer paid and active goods orders before checking older debt", async () => {
    const source = await Bun.file(
      new URL(
        "../repositories/payment-lifecycle.repository.ts",
        import.meta.url
      )
    ).text();
    const start = source.indexOf("const admitPaymentSession = Effect.fn(");
    const end = source.indexOf("const createPendingNexiAttempt", start);
    const admission = source.slice(start, end);
    const paidResolution = admission.indexOf(
      'if (order.paymentState === "paid")'
    );
    const activeResolution = admission.indexOf(
      "activeAttempt &&",
      paidResolution
    );
    const outstandingDebtGate = admission.indexOf(
      'if (order.kind === "goods")',
      activeResolution
    );

    expect(paidResolution).toBeGreaterThanOrEqual(0);
    expect(activeResolution).toBeGreaterThan(paidResolution);
    expect(outstandingDebtGate).toBeGreaterThan(activeResolution);
  });

  test("resolves paid and pending reservation retries before checking hold expiry", async () => {
    const source = await Bun.file(
      new URL(
        "../repositories/payment-lifecycle.repository.ts",
        import.meta.url
      )
    ).text();
    const start = source.indexOf("const admitPaymentSession = Effect.fn(");
    const end = source.indexOf("const createPendingNexiAttempt", start);
    const admission = source.slice(start, end);
    const paidResolution = admission.indexOf(
      'if (order.paymentState === "paid")'
    );
    const activeResolution = admission.indexOf(
      "activeAttempt &&",
      paidResolution
    );
    const payableReservationGate = admission.indexOf(
      "yield* validatePayableReservationForAdmission"
    );
    const gateStart = source.indexOf(
      "const validatePayableReservationForAdmission = Effect.fn("
    );
    const gateEnd = source.indexOf(
      "const loadActiveAttemptForAdmission",
      gateStart
    );
    const payableReservation = source.slice(gateStart, gateEnd);

    expect(payableReservationGate).toBeGreaterThan(activeResolution);
    expect(payableReservation).toContain(
      "Temporal.Instant.compare(reservation.reservationHoldExpiresAt, now) <= 0"
    );
  });

  test("locks a reservation before its canonical order during admission", async () => {
    const source = await Bun.file(
      new URL(
        "../repositories/payment-lifecycle.repository.ts",
        import.meta.url
      )
    ).text();
    const start = source.indexOf("const admitPaymentSession = Effect.fn(");
    const end = source.indexOf("const createPendingNexiAttempt", start);
    const admission = source.slice(start, end);
    const reservationLock = admission.indexOf(
      "yield* lockReservationForAdmission"
    );
    const orderLock = admission.indexOf("const [order] = yield* tx");
    const lockHelperStart = source.indexOf(
      "const lockReservationForAdmission = Effect.fn("
    );
    const lockHelperEnd = source.indexOf(
      "const validatePayableReservationForAdmission",
      lockHelperStart
    );
    const lockHelper = source.slice(lockHelperStart, lockHelperEnd);

    expect(admission).toContain(
      'input.evidence.mode === "reservation_attempt_commitment"'
    );
    expect(reservationLock).toBeGreaterThanOrEqual(0);
    expect(orderLock).toBeGreaterThan(reservationLock);
    expect(lockHelper).toContain(".from(workspaceReservations)");
    expect(lockHelper).toContain('.for("update")');
  });
});
