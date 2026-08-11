import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Predicate, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { NexiRuntimeConfig } from "../config";
import type { OrderResponse } from "../generated/effect.gen";
import {
  getNexiPaymentMetadata,
  NexiCorrelationIdSchema,
  NexiCustomerReferenceSchema,
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  type PaymentOutcomeStatus,
  type PaymentVerificationResult,
} from "../types";
import { mapNexiClientError, NexiGeneratedClient } from "./api";
import { NexiService } from "./service";

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
  const serviceLayer = NexiService.DefaultWithoutDependencies.pipe(
    Layer.provide(NexiGeneratedClient.Live),
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

  test("builds and sends the hosted-page request", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        hostedPage: "https://pay.example.test",
        securityToken: "security-token",
      })
    );

    const result = await runWithService(
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
            email: "ada@example.test",
            mobilePhone: {
              countryCallingCode: "420",
              nationalNumber: "777777777",
            },
          },
        });
      }),
      fetchMock
    );

    expect(result).toEqual({
      orderId: nexiOrderId("order-id"),
      hostedPage: "https://pay.example.test",
      securityToken: "security-token",
    });

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
          cardHolderEmail: "ada@example.test",
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
});

describe("NexiService verifyPaymentOutcome", () => {
  test("gets orders with API key and correlation header", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        orderId: nexiOrderId("order-id"),
        orderStatus: {
          order: {
            orderId: nexiOrderId("order-id"),
            amount: "5000",
            currency: "CZK",
          },
        },
      } satisfies OrderResponse)
    );

    await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.verifyPaymentOutcome({
          orderId: nexiOrderId("order-id"),
          correlationId: nexiCorrelationId("correlation-id"),
          amount: "5000",
          currency: "CZK",
          securityToken: "security-token",
        });
      }),
      fetchMock
    );

    const call = fetchMock.mock.calls[0] as FetchCall;
    expect(getUrl(call)).toBe(
      "https://nexi.example.test/api/phoenix-0.0/psp/api/v1/orders/order-id"
    );
    expect(getMethod(call)).toBe("GET");
    expect(getHeader(call, "X-API-KEY")).toBe("api-key");
    expect(getHeader(call, "Correlation-Id")).toBe("correlation-id");
  });

  test("exposes the executed provider operation ID in payment metadata", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        orderStatus: {
          order: {
            orderId: nexiOrderId("order-id"),
            amount: "5000",
            currency: "CZK",
          },
        },
        operations: [
          {
            operationId: nexiOperationId("operation-id"),
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationAmount: "5000",
            operationCurrency: "CZK",
            securityToken: "security-token",
          },
        ],
      } satisfies OrderResponse)
    );

    const verification = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.verifyPaymentOutcome({
          orderId: nexiOrderId("order-id"),
          correlationId: nexiCorrelationId("correlation-id"),
          amount: "5000",
          currency: "CZK",
          securityToken: "security-token",
        });
      }),
      fetchMock
    );

    expect(verification.provider.operationId).toBe(
      nexiOperationId("operation-id")
    );
    expect(getNexiPaymentMetadata(verification).providerOperationId).toBe(
      nexiOperationId("operation-id")
    );
  });

  test("classifies success, failure, pending, and mismatches", async () => {
    const cases: Array<{
      name: string;
      order: OrderResponse;
      status: PaymentOutcomeStatus;
      mismatches: Array<PaymentVerificationResult["mismatches"][number]>;
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
            customerInfo: { cardHolderEmail: "must-not-leak@example.test" },
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

  test("lists sanitized operations with documented filters", async () => {
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
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fromTime: "2026-08-01T00:00:00Z",
      toTime: "2026-08-07T00:00:00Z",
      maxRecords: "100",
      channel: "BACKOFFICE",
      operationType: "REFUND",
    });
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
