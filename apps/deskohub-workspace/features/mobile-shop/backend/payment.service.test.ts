import { describe, expect, mock, test } from "bun:test";
import { DotyposCustomerIdSchema, DotyposService } from "@deskohub/dotypos";
import {
  NetworkError,
  NexiCorrelationIdSchema,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { Effect, Layer } from "effect";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import {
  mobileShopPaymentAttemptIdSchema,
  mobileShopPurchaseIdSchema,
} from "../contracts";
import { MobileShopPaymentService } from "./payment.service";
import {
  type MobileShopPaymentRecord,
  MobileShopPurchaseLifecycleRepository,
} from "./purchase-lifecycle.repository";

const purchaseId = mobileShopPurchaseIdSchema.make("purchase-1");
const customerId = DotyposCustomerIdSchema.make("customer-1");
const attemptId = mobileShopPaymentAttemptIdSchema.make("attempt-1");
const providerOrderId = NexiOrderIdSchema.make("provider-order-1");
const hostedPageUrl = "https://payments.example.test/hosted";
const now = Temporal.Instant.from("2026-08-11T12:00:00Z");
const payment = {
  order: {
    id: purchaseId,
    correlationId: NexiCorrelationIdSchema.make("correlation-1"),
    locale: "en-US",
  },
  attempt: {
    id: attemptId,
    state: "pending",
    providerOrderId,
    providerRedirectUrl: hostedPageUrl,
    securityToken: "security-token",
    amountValue: 5000,
    amountExponent: 2,
    currency: "CZK",
    updatedAt: now,
  },
} as MobileShopPaymentRecord;

const pendingPayment = {
  ...payment,
  order: {
    ...payment.order,
    paymentState: "pending",
  },
} as MobileShopPaymentRecord;

const runPayment = (input: {
  readonly preparePayment: ReturnType<typeof mock>;
  readonly createHostedPaymentPage?: ReturnType<typeof mock>;
  readonly getCustomer?: ReturnType<typeof mock>;
}) => {
  const createHostedPaymentPage =
    input.createHostedPaymentPage ??
    mock(() =>
      Effect.succeed({ hostedPage: hostedPageUrl, securityToken: "token-2" })
    );
  const getCustomer =
    input.getCustomer ??
    mock(() =>
      Effect.succeed({
        id: customerId,
        _cloudId: "cloud-1",
        firstName: "Ada",
        lastName: "Customer",
        email: "customer@example.test",
        points: null,
        flags: "0",
        display: true,
        deleted: false,
      })
    );
  const attachProviderSession = mock(() =>
    Effect.succeed({
      ...payment,
      attempt: {
        ...payment.attempt,
        securityToken: "token-2",
      },
    })
  );
  const markProviderCreationFailed = mock(() => Effect.void);
  const capture = mock(() => Effect.void);
  const layer = MobileShopPaymentService.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(MobileShopPurchaseLifecycleRepository, {
          preparePayment: input.preparePayment,
          attachProviderSession,
          markProviderCreationFailed,
        }),
        Layer.mock(DotyposService, { getCustomer }),
        Layer.mock(NexiService, { createHostedPaymentPage }),
        Layer.mock(PostHogEventService, { capture })
      )
    )
  );
  return {
    result: Effect.runPromise(
      Effect.gen(function* () {
        const payments = yield* MobileShopPaymentService;
        return yield* payments.startPayment({ purchaseId, customerId });
      }).pipe(Effect.provide(layer))
    ),
    createHostedPaymentPage,
    getCustomer,
    attachProviderSession,
    markProviderCreationFailed,
    capture,
  };
};

describe("mobile shop payment creation", () => {
  test("reuses an attached active hosted page without another provider call", async () => {
    const harness = runPayment({
      preparePayment: mock(() =>
        Effect.succeed({ kind: "existing" as const, payment })
      ),
    });
    await expect(harness.result).resolves.toEqual({
      orderId: purchaseId,
      hostedPageUrl,
    });
    expect(harness.getCustomer).not.toHaveBeenCalled();
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
    expect(harness.attachProviderSession).not.toHaveBeenCalled();
  });

  test("creates a shop-owned HPP with the dedicated callback and canonical app return", async () => {
    const harness = runPayment({
      preparePayment: mock(() =>
        Effect.succeed({ kind: "created" as const, payment })
      ),
    });
    await expect(harness.result).resolves.toEqual({
      orderId: purchaseId,
      hostedPageUrl,
    });
    expect(harness.createHostedPaymentPage).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: providerOrderId,
        notificationUrl: expect.stringContaining(
          "/api/webhooks/nexi/mobile-shop"
        ),
        resultUrl: `http://deskohub.test/api/v1/mobile/payment-return/${purchaseId}?locale=en-US`,
        cancelUrl: `http://deskohub.test/api/v1/mobile/payment-return/${purchaseId}?locale=en-US&outcome=cancelled`,
      })
    );
    expect(harness.attachProviderSession).toHaveBeenCalledTimes(1);
    expect(harness.capture).toHaveBeenCalledTimes(1);
  });

  test("releases an ambiguous provider creation so the order can be retried", async () => {
    const createHostedPaymentPage = mock(() =>
      Effect.fail(new NetworkError({ message: "response lost" }))
    );
    const harness = runPayment({
      preparePayment: mock(() =>
        Effect.succeed({ kind: "created" as const, payment })
      ),
      createHostedPaymentPage,
    });
    await expect(harness.result).rejects.toMatchObject({
      reason: "provider_unavailable",
    });
    expect(createHostedPaymentPage).toHaveBeenCalledTimes(1);
    expect(harness.markProviderCreationFailed).toHaveBeenCalledWith({
      paymentAttemptId: attemptId,
      failureCode: "nexi_hpp_create_ambiguous",
    });
    expect(harness.attachProviderSession).not.toHaveBeenCalled();
  });

  test("releases a new attempt when customer lookup fails before calling Nexi", async () => {
    const harness = runPayment({
      preparePayment: mock(() =>
        Effect.succeed({ kind: "created" as const, payment })
      ),
      getCustomer: mock(() => Effect.fail(new Error("customer unavailable"))),
    });

    await expect(harness.result).rejects.toMatchObject({
      reason: "customer_unavailable",
    });
    expect(harness.markProviderCreationFailed).toHaveBeenCalledWith({
      paymentAttemptId: attemptId,
      failureCode: "customer_unavailable",
    });
    expect(harness.createHostedPaymentPage).not.toHaveBeenCalled();
  });

  test("reconciles a paid provider result when the webhook was not delivered", async () => {
    const findPaymentForOwner = mock(() => Effect.succeed(pendingPayment));
    const markPaid = mock(() =>
      Effect.succeed({
        changed: true,
        additionalPayment: false,
        payment: pendingPayment,
        timestamp: now,
      })
    );
    const verifyPaymentOutcome = mock(() =>
      Effect.succeed({
        status: "success" as const,
        provider: {
          orderId: providerOrderId,
          operationId: "operation-1",
          amount: "5000",
          currency: "CZK",
          orderStatus: "EXECUTED",
          captureExecuted: true,
        },
        mismatches: [],
      })
    );
    const capture = mock(() => Effect.void);
    const layer = MobileShopPaymentService.Live.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(MobileShopPurchaseLifecycleRepository, {
            findPaymentForOwner,
            markPaid,
          }),
          Layer.mock(DotyposService, {}),
          Layer.mock(NexiService, { verifyPaymentOutcome }),
          Layer.mock(PostHogEventService, { capture })
        )
      )
    );

    await Effect.gen(function* () {
      const payments = yield* MobileShopPaymentService;
      yield* payments.reconcilePayment({ purchaseId, customerId });
    }).pipe(Effect.provide(layer), Effect.runPromise);

    expect(findPaymentForOwner).toHaveBeenCalledWith({
      purchaseId,
      customerId,
    });
    expect(verifyPaymentOutcome).toHaveBeenCalledWith({
      orderId: providerOrderId,
      correlationId: pendingPayment.order.correlationId,
      amount: "5000",
      currency: "EUR",
      securityToken: "security-token",
    });
    expect(markPaid).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentAttemptId: attemptId,
        providerOperationId: "operation-1",
        providerStatus: "EXECUTED",
      })
    );
    expect(capture).toHaveBeenCalledTimes(1);
  });
});

describe("mobile shop payment recovery", () => {
  test("returns an owned active hosted page without creating another attempt", async () => {
    const findPaymentForOwner = mock(() => Effect.succeed(pendingPayment));
    const preparePayment = mock(() => Effect.die("must not create"));
    const layer = MobileShopPaymentService.Live.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.mock(MobileShopPurchaseLifecycleRepository, {
            findPaymentForOwner,
            preparePayment,
          }),
          Layer.mock(DotyposService, {}),
          Layer.mock(NexiService, {}),
          Layer.mock(PostHogEventService, {})
        )
      )
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const payments = yield* MobileShopPaymentService;
        return yield* payments.resumePayment({ purchaseId, customerId });
      }).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ orderId: purchaseId, hostedPageUrl });
    expect(findPaymentForOwner).toHaveBeenCalledTimes(1);
    expect(preparePayment).not.toHaveBeenCalled();
  });

  test("does not resume an incomplete or inactive payment attempt", async () => {
    for (const paymentRecord of [
      {
        ...pendingPayment,
        attempt: { ...pendingPayment.attempt, state: "created" as const },
      },
      {
        ...pendingPayment,
        attempt: { ...pendingPayment.attempt, securityToken: null },
      },
      {
        ...pendingPayment,
        attempt: { ...pendingPayment.attempt, providerRedirectUrl: null },
      },
    ]) {
      const layer = MobileShopPaymentService.Live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(MobileShopPurchaseLifecycleRepository, {
              findPaymentForOwner: mock(() => Effect.succeed(paymentRecord)),
            }),
            Layer.mock(DotyposService, {}),
            Layer.mock(NexiService, {}),
            Layer.mock(PostHogEventService, {})
          )
        )
      );

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const payments = yield* MobileShopPaymentService;
          return yield* payments.resumePayment({ purchaseId, customerId });
        }).pipe(Effect.provide(layer))
      );

      expect(result).toBeNull();
    }
  });
});
