import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Predicate } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { NexiRuntimeConfig } from "../config";
import type { OrderResponse } from "../generated/effect.gen";
import {
  getNexiPaymentMetadata,
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
          orderId: "order-id",
          correlationId: "correlation-id",
          amount: "5000",
          currency: "CZK",
          locale: "en-US",
          resultUrl: "https://example.test/result",
          cancelUrl: "https://example.test/cancel",
          notificationUrl: "https://example.test/webhook",
        });
      }),
      fetchMock
    );

    expect(result).toEqual({
      orderId: "order-id",
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
      order: { orderId: "order-id", amount: "5000", currency: "CZK" },
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
});

describe("NexiService verifyPaymentOutcome", () => {
  test("gets orders with API key and correlation header", async () => {
    const fetchMock = mockNexiFetch(
      Response.json({
        orderId: "order-id",
        orderStatus: {
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
      } satisfies OrderResponse)
    );

    await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.verifyPaymentOutcome({
          orderId: "order-id",
          correlationId: "correlation-id",
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
            orderId: "order-id",
            amount: "5000",
            currency: "CZK",
          },
        },
        operations: [
          {
            operationId: "operation-id",
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
          orderId: "order-id",
          correlationId: "correlation-id",
          amount: "5000",
          currency: "CZK",
          securityToken: "security-token",
        });
      }),
      fetchMock
    );

    expect(verification.provider.operationId).toBe("operation-id");
    expect(getNexiPaymentMetadata(verification).providerOperationId).toBe(
      "operation-id"
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
            order: { orderId: "order-id", amount: "5000", currency: "CZK" },
          },
          operations: [
            {
              operationId: "capture-id",
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
            order: { orderId: "order-id", amount: "5000", currency: "CZK" },
          },
          operations: [
            {
              operationId: "declined-id",
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
            order: { orderId: "order-id", amount: "5000", currency: "CZK" },
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
            order: { orderId: "order-id", amount: "5000", currency: "CZK" },
          },
          operations: [
            {
              operationId: "capture-id",
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
            orderId: "order-id",
            correlationId: item.name,
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
            orderId: "order-id",
            correlationId: "correlation-id",
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
