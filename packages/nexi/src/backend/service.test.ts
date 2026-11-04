import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Duration, Effect, Fiber, Layer, Predicate, Schema } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { NexiRuntimeConfig } from "../config";
import type { OrderResponse } from "../generated/effect.gen";
import {
  NexiCorrelationIdSchema,
  NexiCustomerReferenceSchema,
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  type PaymentOutcomeStatus,
  type PaymentVerificationResult,
} from "../types";
import { mapNexiClientError, NexiGeneratedClient } from "./api";
import { getNexiRequestWorstCaseDuration } from "./request-policy";
import { NexiService } from "./service";

const adaEmail = testEmailAddress("ada");
const mustNotLeakEmail = testEmailAddress("must-not-leak");

const config = {
  baseUrl: "https://nexi.example.test",
  apiKey: "api-key",
  apiTimeout: 1000,
};

const nexiOrderId = Schema.decodeUnknownSync(NexiOrderIdSchema);
const nexiOperationId = Schema.decodeUnknownSync(NexiOperationIdSchema);
const nexiCorrelationId = Schema.decodeUnknownSync(NexiCorrelationIdSchema);
const nexiCustomerReference = Schema.decodeUnknownSync(
  NexiCustomerReferenceSchema
);

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, NexiService>,
  fetchMock: typeof globalThis.fetch
) => {
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock))
  );
  const serviceLayer = NexiService.Default.pipe(
    Layer.provide(NexiGeneratedClient.Default),
    Layer.provide(
      Layer.merge(Layer.succeed(NexiRuntimeConfig, config), httpClientLayer)
    )
  );
  return Effect.runPromise(effect.pipe(Effect.provide(serviceLayer)));
};

const mockNexiFetch = (response: Response) => {
  const fetchMock = mock(
    async (_input: RequestInfo | URL, _init?: RequestInit) => response.clone()
  );
  return fetchMock as unknown as typeof globalThis.fetch & typeof fetchMock;
};

type FetchCall = [RequestInfo | URL, RequestInit?];

const getUrl = ([input]: FetchCall) =>
  input instanceof Request ? input.url : String(input);

const getMethod = ([input, init]: FetchCall) =>
  init?.method ?? (input instanceof Request ? input.method : "GET");

const getHeader = ([input, init]: FetchCall, name: string) =>
  new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : {})
  ).get(name);

const readJsonBody = async ([input, init]: FetchCall) => {
  const body =
    init?.body ?? (input instanceof Request ? input.clone().body : null);
  return JSON.parse(await new Response(body).text());
};

describe("NexiService hosted payment pages", () => {
  test("unwraps generated provider errors", () => {
    const error = mapNexiClientError(
      {
        response: { status: 402 },
        cause: {
          status: 402,
          errors: [{ description: "Payment declined" }],
        },
      } as never,
      "Get order"
    );

    if (!Predicate.isTagged(error, "ExternalAPIError")) {
      throw new Error("Expected ExternalAPIError");
    }
    expect(error.statusCode).toBe(402);
    expect(error.message).toBe("Payment declined");
  });

  test("keeps an unclassified client failure as the error cause", () => {
    const failure = new Error("unexpected client failure");
    const error = mapNexiClientError(failure, "Get order");

    expect(error).toMatchObject({
      _tag: "ExternalAPIError",
      service: "Nexi",
      operation: "Get order",
    });
    expect(error).not.toHaveProperty("statusCode");
    expect(error.cause).toBe(failure);
  });

  test("builds and sends the hosted-page request", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        hostedPage: "https://pay.example.test",
        securityToken: "security-token",
      })
    );

    await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.createHostedPaymentPage({
          orderId: nexiOrderId("order-id"),
          correlationId: nexiCorrelationId("correlation-id"),
          amount: "5000",
          currency: "CZK",
          locale: "en-US",
          resultUrl: "https://example.test/result",
          cancelUrl: "https://example.test/cancel",
          notificationUrl: "https://example.test/webhook",
          customer: {
            id: nexiCustomerReference("customer-id"),
            name: "Ada Lovelace",
            email: adaEmail,
            mobilePhone: {
              countryCallingCode: "420",
              nationalNumber: "777777777",
            },
          },
        });
      }),
      fetchMock
    );

    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(getUrl(call)).toBe(
      "https://nexi.example.test/api/phoenix-0.0/psp/api/v1/orders/hpp"
    );
    expect(getMethod(call)).toBe("POST");
    expect(getHeader(call, "X-API-KEY")).toBe("api-key");
    expect(getHeader(call, "Correlation-Id")).toBe("correlation-id");
    expect(getHeader(call, "Content-Type")).toContain("application/json");
    expect(await readJsonBody(call)).toEqual({
      order: {
        orderId: nexiOrderId("order-id"),
        amount: "5000",
        currency: "CZK",
        customerId: "customer-id",
        customerInfo: {
          cardHolderName: "Ada Lovelace",
          cardHolderEmail: adaEmail,
          mobilePhoneCountryCode: "420",
          mobilePhone: "777777777",
        },
      },
      paymentSession: {
        amount: "5000",
        language: "ENG",
        resultUrl: "https://example.test/result",
        cancelUrl: "https://example.test/cancel",
        notificationUrl: "https://example.test/webhook",
        paymentService: "CARDS",
        captureType: "IMPLICIT",
        actionType: "PAY",
      },
    });
  });

  test("rejects an empty hosted-payment security token", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        hostedPage: "https://pay.example.test",
        securityToken: "",
      })
    );

    await expect(
      runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi.createHostedPaymentPage({
            orderId: nexiOrderId("order-id"),
            correlationId: nexiCorrelationId("correlation-id"),
            amount: "5000",
            currency: "CZK",
            locale: "en-US",
            resultUrl: "https://example.test/result",
            cancelUrl: "https://example.test/cancel",
            notificationUrl: "https://example.test/webhook",
          });
        }),
        fetchMock
      )
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Nexi documents no idempotency key for POST /orders/hpp, so a failure
  // that may follow a committed creation must not be replayed automatically.
  test.each([
    ["a provider 5xx", () => Response.json({}, { status: 503 })],
    [
      "a transport failure",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
  ])(
    "does not resend hosted payment page creation after %s",
    async (_label, respond) => {
      const fetchMock = mock(
        async (_input: RequestInfo | URL, _init?: RequestInit) => respond()
      ) as unknown as typeof globalThis.fetch & ReturnType<typeof mock>;

      const result = await runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi
            .createHostedPaymentPage({
              orderId: nexiOrderId("order-id"),
              correlationId: nexiCorrelationId("correlation-id"),
              amount: "5000",
              currency: "CZK",
              locale: "en-US",
              resultUrl: "https://example.test/result",
              cancelUrl: "https://example.test/cancel",
              notificationUrl: "https://example.test/webhook",
            })
            .pipe(Effect.result);
        }),
        fetchMock
      );

      expect(Predicate.isTagged(result, "Failure")).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );
});

describe("NexiService verifyPaymentOutcome", () => {
  test("retries an order lookup after a provider 5xx", async () => {
    let calls = 0;
    const fetchMock = mock(async () =>
      calls++ === 0
        ? Response.json({}, { status: 503 })
        : Response.json({ orderId: "order-id", operations: [] })
    ) as unknown as typeof globalThis.fetch & ReturnType<typeof mock>;

    await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.getOrder({
          orderId: nexiOrderId("order-id"),
          correlationId: nexiCorrelationId("correlation-id"),
        });
      }),
      fetchMock
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("classifies success, failure, pending, and mismatches", async () => {
    const cases: Array<{
      name: string;
      order: OrderResponse;
      status: PaymentOutcomeStatus;
      mismatches: Array<PaymentVerificationResult["mismatches"][number]>;
      operationId?: PaymentVerificationResult["provider"]["operationId"];
    }> = [
      {
        name: "success",
        order: {
          orderStatus: {
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
            },
          },
          operations: [
            {
              operationId: nexiOperationId("capture-id"),
              operationType: "CAPTURE",
              operationResult: "EXECUTED",
              operationAmount: "5000",
              operationCurrency: "CZK",
              securityToken: "security-token",
            },
          ],
        },
        status: "success",
        mismatches: [],
      },
      {
        name: "failure",
        order: {
          orderStatus: {
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
            },
          },
          operations: [
            {
              operationId: nexiOperationId("declined-id"),
              operationType: "AUTHORIZATION",
              operationResult: "DECLINED",
            },
          ],
        },
        status: "failure",
        mismatches: [],
      },
      {
        name: "pending",
        order: {
          orderStatus: {
            authorizedAmount: "0",
            capturedAmount: "0.00",
            lastOperationType: "PENDING",
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
            },
          },
          operations: [],
        },
        status: "pending",
        mismatches: [],
      },
      {
        name: "mismatch",
        order: {
          orderStatus: {
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
            },
          },
          operations: [
            {
              operationId: nexiOperationId("capture-id"),
              operationType: "CAPTURE",
              operationResult: "EXECUTED",
              operationAmount: "9999",
              operationCurrency: "CZK",
              securityToken: "security-token",
            },
          ],
        },
        status: "failure",
        mismatches: ["amount"],
      },
      {
        name: "paid order refunded in the back office",
        order: {
          orderStatus: {
            lastOperationType: "REFUND",
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
            },
          },
          operations: [
            {
              operationId: nexiOperationId("capture-id"),
              operationType: "CAPTURE",
              operationResult: "EXECUTED",
              operationAmount: "5000",
              operationCurrency: "CZK",
              securityToken: "security-token",
            },
            {
              operationId: nexiOperationId("refund-id"),
              operationType: "REFUND",
              operationResult: "VOIDED",
              operationAmount: "5000",
              operationCurrency: "CZK",
            },
          ],
        },
        status: "success",
        mismatches: [],
        operationId: nexiOperationId("capture-id"),
      },
      {
        name: "voided refund without a settled payment",
        order: {
          orderStatus: {
            lastOperationType: "REFUND",
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
            },
          },
          operations: [
            {
              operationId: nexiOperationId("refund-id"),
              operationType: "REFUND",
              operationResult: "VOIDED",
              operationAmount: "5000",
              operationCurrency: "CZK",
            },
          ],
        },
        status: "pending",
        mismatches: [],
      },
    ];

    for (const item of cases) {
      const fetchMock = mockNexiFetch(Response.json(item.order));
      const result = await runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi.verifyPaymentOutcome({
            orderId: nexiOrderId("order-id"),
            correlationId: nexiCorrelationId(item.name),
            amount: "5000",
            currency: "CZK",
            securityToken: "security-token",
          });
        }),
        fetchMock
      );

      expect(result.status).toBe(item.status);
      expect(result.mismatches).toEqual(item.mismatches);
      if (item.operationId) {
        expect(result.provider.operationId).toBe(item.operationId);
      }
      expect(result.provider.operationCount).toBe(
        item.order.operations?.length ?? 0
      );
      if (item.name === "pending") {
        expect(result.provider.authorizedAmount).toBe("0");
        expect(result.provider.capturedAmount).toBe("0.00");
      }
    }
  });

  test("maps provider status codes to ExternalAPIError", async () => {
    const fetchMock = mockNexiFetch(
      Response.json(
        {
          status: 422,
          message: "Provider rejected",
          errors: [{ description: "Invalid amount" }],
        },
        { status: 422 }
      )
    );
    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi
          .verifyPaymentOutcome({
            orderId: nexiOrderId("order-id"),
            correlationId: nexiCorrelationId("correlation-id"),
            amount: "5000",
            currency: "CZK",
            securityToken: "security-token",
          })
          .pipe(Effect.result);
      }),
      fetchMock
    );

    expect(Predicate.isTagged(result, "Failure")).toBe(true);
    if (Predicate.isTagged(result, "Failure")) {
      expect(Predicate.isTagged(result.failure, "ExternalAPIError")).toBe(true);
      expect(result.failure).toMatchObject({
        service: "Nexi",
        operation: "Get order",
        statusCode: 422,
        message: "Provider rejected",
        cause: [{ description: "Invalid amount" }],
      });
    }
  });

  test("stops retrying an unanswered order lookup at its deadline", async () => {
    const fetchMock = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );
    const { finished, result } = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        const lookup = yield* Effect.forkChild(
          nexi
            .verifyPaymentOutcome({
              orderId: nexiOrderId("order-id"),
              correlationId: nexiCorrelationId("correlation-id"),
              amount: "5000",
              currency: "CZK",
              securityToken: "security-token",
              deadline: "2500 millis",
            })
            .pipe(Effect.result)
        );
        for (let step = 0; step < 25; step += 1) {
          yield* TestClock.adjust("100 millis");
        }
        const finished = lookup.pollUnsafe() !== undefined;
        if (!finished) yield* Fiber.interrupt(lookup);
        return {
          finished,
          result: finished ? yield* Fiber.join(lookup) : undefined,
        };
      }).pipe(Effect.provide(TestClock.layer())),
      fetchMock as unknown as typeof globalThis.fetch
    );

    expect(finished).toBe(true);
    expect(result).toMatchObject({
      failure: {
        _tag: "NetworkError",
        message: "Nexi order lookup exceeded its deadline",
      },
    });
    // The 1-second request timeout fired and the lookup was retried before
    // the deadline stopped it.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe("NexiService verifyPaymentOutcome evidence", () => {
  const verify = (
    order: unknown,
    input: { readonly currency?: "CZK" | "EUR" } = { currency: "CZK" }
  ) =>
    runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.verifyPaymentOutcome({
          orderId: nexiOrderId("order-id"),
          correlationId: nexiCorrelationId("correlation-id"),
          amount: "5000",
          securityToken: "security-token",
          ...input,
        });
      }),
      mockNexiFetch(Response.json(order))
    );

  test("reports every contradicted payment fact in check order", async () => {
    const result = await verify({
      orderStatus: {
        order: { orderId: "other-order", amount: "5000", currency: "CZK" },
      },
      operations: [
        {
          operationId: "capture-id",
          operationType: "CAPTURE",
          operationResult: "EXECUTED",
          operationAmount: "4000",
          operationCurrency: "EUR",
          securityToken: "other-token",
        },
      ],
    });

    expect(result.status).toBe("failure");
    expect(result.mismatches).toEqual([
      "orderId",
      "amount",
      "currency",
      "securityToken",
    ]);
    expect(result.provider).toMatchObject({
      orderId: nexiOrderId("other-order"),
      operationId: nexiOperationId("capture-id"),
      amount: "4000",
      currency: "EUR",
      orderStatus: "EXECUTED",
      captureExecuted: true,
    });
  });

  test("checks the order's security token only when Nexi reports one", async () => {
    const pendingOrder = (securityToken: string) => ({
      securityToken,
      orderStatus: {
        lastOperationType: "PENDING",
        order: { orderId: "order-id", amount: "5000", currency: "CZK" },
      },
    });

    const emptyToken = await verify(pendingOrder(""));
    const otherToken = await verify(pendingOrder("other-token"));

    expect(emptyToken.status).toBe("pending");
    expect(emptyToken.mismatches).toEqual([]);
    expect(otherToken.status).toBe("failure");
    expect(otherToken.mismatches).toEqual(["securityToken"]);
  });

  test("fails a payment whose last operation type is a failure status in any case", async () => {
    const result = await verify({
      orderStatus: {
        lastOperationType: "denied",
        order: { orderId: "order-id", amount: "5000", currency: "CZK" },
      },
      operations: [],
    });

    expect(result.status).toBe("failure");
    expect(result.mismatches).toEqual([]);
    expect(result.provider.orderStatus).toBe("denied");
    expect(result.provider.operationId).toBeUndefined();
    expect(result.provider.captureExecuted).toBe(false);
  });

  test("reports the failed operation when nothing executed", async () => {
    const result = await verify({
      orderStatus: {
        lastOperationType: "AUTHORIZATION",
        order: { orderId: "order-id", amount: "5000", currency: "CZK" },
      },
      operations: [
        {
          operationId: "pending-id",
          operationType: "AUTHORIZATION",
          operationResult: "PENDING",
        },
        {
          operationId: "declined-id",
          operationType: "AUTHORIZATION",
          operationResult: "DECLINED",
        },
      ],
    });

    expect(result.status).toBe("failure");
    expect(result.provider.operationId).toBe(nexiOperationId("declined-id"));
    expect(result.provider.orderStatus).toBe("DECLINED");
    expect(result.provider.operationCount).toBe(2);
  });

  test("reads an executed authorization's amount and the response order ID without an order status", async () => {
    const result = await verify(
      {
        orderId: "order-id",
        securityToken: "other-token",
        operations: [
          {
            operationId: "authorization-id",
            operationType: "AUTHORIZATION",
            operationResult: "EXECUTED",
            amount: { amount: "5000", currency: "EUR" },
            securityToken: "security-token",
          },
        ],
      },
      { currency: "EUR" }
    );

    expect(result.status).toBe("success");
    expect(result.mismatches).toEqual([]);
    expect(result.provider).toEqual({
      orderId: nexiOrderId("order-id"),
      operationId: nexiOperationId("authorization-id"),
      operationCount: 1,
      amount: "5000",
      currency: "EUR",
      authorizedAmount: undefined,
      capturedAmount: undefined,
      orderStatus: "EXECUTED",
      captureExecuted: true,
    });
  });

  test("keeps the submitted order ID and reports no amount when Nexi reports neither", async () => {
    const withoutCurrency = await verify({}, {});
    const withCurrency = await verify({});

    expect(withoutCurrency.provider.orderId).toBe(nexiOrderId("order-id"));
    expect(withoutCurrency.provider.operationCount).toBe(0);
    expect(withoutCurrency.provider.amount).toBeUndefined();
    expect(withoutCurrency.mismatches).toEqual(["orderId", "amount"]);
    expect(withCurrency.mismatches).toEqual(["orderId", "amount", "currency"]);
    expect(withCurrency.status).toBe("failure");
  });
});

describe("NexiService request retries", () => {
  test("gives up on an unanswered order lookup within its worst-case duration", async () => {
    const fetchMock = mock(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );
    const { elapsedMilliseconds, result } = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        const lookup = yield* Effect.forkChild(
          nexi
            .getOrder({
              orderId: nexiOrderId("order-id"),
              correlationId: nexiCorrelationId("correlation-id"),
            })
            .pipe(Effect.result)
        );
        let elapsedMilliseconds = 0;
        while (lookup.pollUnsafe() === undefined) {
          yield* TestClock.adjust("10 millis");
          elapsedMilliseconds += 10;
        }
        return { elapsedMilliseconds, result: yield* Fiber.join(lookup) };
      }).pipe(Effect.provide(TestClock.layer())),
      fetchMock as unknown as typeof globalThis.fetch
    );

    expect(result).toMatchObject({ failure: { _tag: "NetworkError" } });
    // The first attempt and three retries each wait out the request timeout.
    expect(fetchMock.mock.calls).toHaveLength(4);
    expect(elapsedMilliseconds).toBeGreaterThan(4 * config.apiTimeout);
    expect(elapsedMilliseconds).toBeLessThanOrEqual(
      Duration.toMillis(getNexiRequestWorstCaseDuration(config.apiTimeout))
    );
  });
});

describe("NexiService administration reads", () => {
  test("returns an allowlisted order with normalized timestamps and all operations", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        securityToken: "must-not-leak",
        orderStatus: {
          authorizedAmount: "5000",
          capturedAmount: "5000",
          lastOperationTime: "2026-08-06 10:01:00.000",
          lastOperationType: "REFUND",
          order: {
            orderId: nexiOrderId("order#id"),
            amount: "5000",
            currency: "CZK",
            customerInfo: { cardHolderEmail: mustNotLeakEmail },
          },
        },
        operations: [
          {
            orderId: nexiOrderId("order#id"),
            operationId: nexiOperationId("capture-id"),
            channel: "ECOMMERCE",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationTime: "2026-08-06 10:00:00.000",
            operationAmount: "5000",
            operationCurrency: "CZK",
            securityToken: "must-not-leak",
            paymentInstrumentInfo: "must-not-leak",
          },
          {
            orderId: nexiOrderId("order#id"),
            operationId: nexiOperationId("refund-id"),
            channel: "BACKOFFICE",
            operationType: "REFUND",
            operationResult: "REFUNDED",
            operationTime: "2026-08-06 10:01:00.000",
            operationAmount: "1000",
            operationCurrency: "CZK",
            cancelledOperationId: "capture-id",
            customerInfo: { cardHolderName: "Must Not Leak" },
          },
        ],
      })
    );

    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.getOrder({
          correlationId: nexiCorrelationId("correlation-id"),
          orderId: nexiOrderId("order#id"),
        });
      }),
      fetchMock
    );

    expect(result).toEqual({
      orderId: nexiOrderId("order#id"),
      amount: "5000",
      currency: "CZK",
      authorizedAmount: "5000",
      capturedAmount: "5000",
      lastOperationTime: "2026-08-06T08:01:00.000Z",
      lastOperationType: "REFUND",
      operations: [
        {
          orderId: nexiOrderId("order#id"),
          operationId: nexiOperationId("capture-id"),
          channel: "ECOMMERCE",
          operationType: "CAPTURE",
          operationResult: "EXECUTED",
          operationTime: "2026-08-06T08:00:00.000Z",
          amount: "5000",
          currency: "CZK",
        },
        {
          orderId: nexiOrderId("order#id"),
          operationId: nexiOperationId("refund-id"),
          channel: "BACKOFFICE",
          operationType: "REFUND",
          operationResult: "REFUNDED",
          operationTime: "2026-08-06T08:01:00.000Z",
          amount: "1000",
          currency: "CZK",
          cancelledOperationId: nexiOperationId("capture-id"),
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("securityToken");
    expect(JSON.stringify(result)).not.toContain("customerInfo");
    expect(JSON.stringify(result)).not.toContain("paymentInstrumentInfo");
    expect(getUrl(fetchMock.mock.calls[0] as FetchCall)).toBe(
      "https://nexi.example.test/api/phoenix-0.0/psp/api/v1/orders/order%23id"
    );
  });

  test("falls back to the response amount and the submitted order ID without an order status", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        amount: { amount: "5000", currency: "CZK" },
        operations: [
          {
            operationId: nexiOperationId("operation-id"),
            operationAmount: "5000",
          },
          {},
        ],
      })
    );

    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.getOrder({
          correlationId: nexiCorrelationId("correlation-id"),
          orderId: nexiOrderId("order-id"),
        });
      }),
      fetchMock
    );

    expect(result).toEqual({
      orderId: nexiOrderId("order-id"),
      amount: "5000",
      currency: "CZK",
      operations: [
        {
          orderId: nexiOrderId("order-id"),
          operationId: nexiOperationId("operation-id"),
          amount: "5000",
        },
        { orderId: nexiOrderId("order-id") },
      ],
    });
  });

  test("normalizes provider wall times without fractional seconds", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        orderStatus: {
          lastOperationTime: "2026-08-06 10:01:00",
          order: {
            orderId: nexiOrderId("order-id"),
            amount: "5000",
            currency: "CZK",
          },
        },
        operations: [
          {
            orderId: nexiOrderId("order-id"),
            operationId: nexiOperationId("operation-id"),
            operationTime: "2026-08-06 10:00:00",
          },
        ],
      })
    );

    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.getOrder({
          correlationId: nexiCorrelationId("correlation-id"),
          orderId: nexiOrderId("order-id"),
        });
      }),
      fetchMock
    );

    expect(result.lastOperationTime).toBe("2026-08-06T08:01:00.000Z");
    expect(result.operations[0]?.operationTime).toBe(
      "2026-08-06T08:00:00.000Z"
    );
  });

  test("lists sanitized operations", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        operations: [
          {
            orderId: nexiOrderId("order-id"),
            operationId: nexiOperationId("operation-id"),
            channel: "BACKOFFICE",
            operationType: "REFUND",
            operationResult: "REFUNDED",
            operationTime: "2026-08-06T10:01:00Z",
            operationAmount: "1000",
            operationCurrency: "CZK",
            additionalData: { private: "must-not-leak" },
          },
        ],
      })
    );
    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.listOperations({
          correlationId: nexiCorrelationId("correlation-id"),
          fromTime: "2026-08-01T00:00:00Z",
          toTime: "2026-08-07T00:00:00Z",
          maxRecords: 100,
          channel: "BACKOFFICE",
          operationType: "REFUND",
        });
      }),
      fetchMock
    );
    expect(result).toEqual([
      {
        orderId: nexiOrderId("order-id"),
        operationId: nexiOperationId("operation-id"),
        channel: "BACKOFFICE",
        operationType: "REFUND",
        operationResult: "REFUNDED",
        operationTime: "2026-08-06T10:01:00Z",
        amount: "1000",
        currency: "CZK",
      },
    ]);
    const url = new URL(getUrl(fetchMock.mock.calls[0] as FetchCall));
    expect(url.pathname).toBe("/api/phoenix-0.0/psp/api/v1/operations");
    expect(
      getHeader(fetchMock.mock.calls[0] as FetchCall, "Correlation-Id")
    ).toBe("correlation-id");
  });

  test("gets one sanitized operation by encoded ID", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        orderId: nexiOrderId("order-id"),
        operationId: nexiOperationId("operation#id"),
        channel: "ECOMMERCE",
        operationType: "CAPTURE",
        operationResult: "EXECUTED",
        operationTime: "2026-08-06T10:00:00Z",
        operationAmount: "5000",
        operationCurrency: "CZK",
        securityToken: "must-not-leak",
      })
    );
    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.getOperation({
          correlationId: nexiCorrelationId("correlation-id"),
          operationId: nexiOperationId("operation#id"),
        });
      }),
      fetchMock
    );
    expect(result).toEqual({
      orderId: nexiOrderId("order-id"),
      operationId: nexiOperationId("operation#id"),
      channel: "ECOMMERCE",
      operationType: "CAPTURE",
      operationResult: "EXECUTED",
      operationTime: "2026-08-06T10:00:00Z",
      amount: "5000",
      currency: "CZK",
    });
    expect(getUrl(fetchMock.mock.calls[0] as FetchCall)).toBe(
      "https://nexi.example.test/api/phoenix-0.0/psp/api/v1/operations/operation%23id"
    );
  });

  test("lists orders with normalized winter timestamps without exposing customer fields", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        orders: [
          {
            order: {
              orderId: nexiOrderId("order-id"),
              amount: "5000",
              currency: "CZK",
              customerInfo: { cardHolderName: "Must Not Leak" },
            },
            capturedAmount: "5000",
            lastOperationType: "CAPTURE",
            lastOperationTime: "2026-01-06 10:00:00.000",
          },
        ],
      })
    );
    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.listOrders({
          correlationId: nexiCorrelationId("correlation-id"),
          maxRecords: 50,
        });
      }),
      fetchMock
    );
    expect(result).toEqual([
      {
        orderId: nexiOrderId("order-id"),
        amount: "5000",
        currency: "CZK",
        capturedAmount: "5000",
        lastOperationTime: "2026-01-06T09:00:00.000Z",
        lastOperationType: "CAPTURE",
        operations: [],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("customerInfo");
  });
});
