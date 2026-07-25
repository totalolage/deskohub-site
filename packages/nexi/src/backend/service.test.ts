import { describe, expect, mock, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type RequestListener } from "node:http";
import { Effect, Layer, Logger, Predicate, References } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
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
  fetchMock: typeof globalThis.fetch,
  runtimeConfig = config
) => {
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchMock)),
    Layer.provide(
      Layer.succeed(FetchHttpClient.RequestInit, {
        redirect: "error",
      })
    )
  );
  const serviceLayer = NexiService.DefaultWithoutDependencies.pipe(
    Layer.provide(NexiGeneratedClient.Live),
    Layer.provide(
      Layer.merge(
        Layer.succeed(NexiRuntimeConfig, runtimeConfig),
        httpClientLayer
      )
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

const listen = async (handler: RequestListener) => {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Synthetic server did not expose an address.");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      const closed = once(server, "close");
      server.close();
      await closed;
    },
  };
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

  test("never retries the state-creating POST after ambiguous or conflicting exits", async () => {
    const responses = [
      () => Promise.reject(new TypeError("transport unavailable")),
      () => Promise.resolve(new Response(undefined, { status: 503 })),
      () => Promise.resolve(new Response(undefined, { status: 409 })),
    ] as const;

    for (const respond of responses) {
      const fetchMock = mock(respond) as unknown as typeof globalThis.fetch &
        ReturnType<typeof mock>;
      const result = await runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi
            .createHostedPaymentPage({
              orderId: "order-id",
              correlationId: "correlation-id",
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

      expect(result._tag).toBe("Failure");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test("rejects same-origin 307 without replaying the state-creating POST", async () => {
    let initialPosts = 0;
    let redirectedPosts = 0;
    const server = await listen((request, response) => {
      if (request.url?.endsWith("/orders/hpp")) {
        initialPosts += request.method === "POST" ? 1 : 0;
        response.writeHead(307, { location: "/redirect-target" });
        response.end();
        return;
      }
      if (request.url === "/redirect-target") {
        redirectedPosts += request.method === "POST" ? 1 : 0;
      }
      response.writeHead(204);
      response.end();
    });

    try {
      const result = await runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi
            .createHostedPaymentPage({
              orderId: "order-id",
              correlationId: "correlation-id",
              amount: "5000",
              currency: "CZK",
              locale: "en-US",
              resultUrl: "https://example.test/result",
              cancelUrl: "https://example.test/cancel",
              notificationUrl: "https://example.test/webhook",
            })
            .pipe(Effect.result);
        }),
        globalThis.fetch,
        {
          ...config,
          baseUrl: server.origin,
          apiKey: randomUUID(),
        }
      );

      expect(Predicate.isTagged(result, "Failure")).toBe(true);
      if (Predicate.isTagged(result, "Failure")) {
        expect(Predicate.isTagged(result.failure, "NetworkError")).toBe(true);
      }
      expect(initialPosts).toBe(1);
      expect(redirectedPosts).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("rejects cross-origin 307 without forwarding the provider credential", async () => {
    let initialPosts = 0;
    let redirectedRequests = 0;
    let redirectedCredentialPresent = false;
    const target = await listen((request, response) => {
      redirectedRequests += 1;
      redirectedCredentialPresent = request.headers["x-api-key"] !== undefined;
      response.writeHead(204);
      response.end();
    });
    const redirector = await listen((request, response) => {
      initialPosts += request.method === "POST" ? 1 : 0;
      response.writeHead(307, { location: `${target.origin}/redirect-target` });
      response.end();
    });

    try {
      const result = await runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi
            .createHostedPaymentPage({
              orderId: "order-id",
              correlationId: "correlation-id",
              amount: "5000",
              currency: "CZK",
              locale: "en-US",
              resultUrl: "https://example.test/result",
              cancelUrl: "https://example.test/cancel",
              notificationUrl: "https://example.test/webhook",
            })
            .pipe(Effect.result);
        }),
        globalThis.fetch,
        {
          ...config,
          baseUrl: redirector.origin,
          apiKey: randomUUID(),
        }
      );

      expect(Predicate.isTagged(result, "Failure")).toBe(true);
      if (Predicate.isTagged(result, "Failure")) {
        expect(Predicate.isTagged(result.failure, "NetworkError")).toBe(true);
      }
      expect(initialPosts).toBe(1);
      expect(redirectedRequests).toBe(0);
      expect(redirectedCredentialPresent).toBe(false);
    } finally {
      await Promise.all([redirector.close(), target.close()]);
    }
  });

  test("logs only a safe projection of HPP inputs and results", async () => {
    const responseMarker = randomUUID();
    const tokenMarker = randomUUID();
    const callbackMarker = randomUUID();
    const providerErrorMarker = randomUUID();
    const captured: unknown[] = [];
    const captureLogger = Logger.make((options) => {
      captured.push({
        message: options.message,
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
      });
    });
    const fetchMock = mockNexiFetch(
      Response.json({
        hostedPage: `https://provider.example/hosted?opaque=${responseMarker}`,
        securityToken: tokenMarker,
      })
    );

    await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        yield* nexi.createHostedPaymentPage({
          orderId: "order-id",
          correlationId: "correlation-id",
          amount: "5000",
          currency: "CZK",
          locale: "en-US",
          resultUrl: `https://example.test/result?opaque=${callbackMarker}`,
          cancelUrl: "https://example.test/cancel",
          notificationUrl: "https://example.test/webhook",
        });
      }).pipe(Effect.provide(Logger.layer([captureLogger]))),
      fetchMock
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(responseMarker);
    expect(serialized).not.toContain(tokenMarker);
    expect(serialized).not.toContain(callbackMarker);

    const failureFetch = mockNexiFetch(
      Response.json(
        {
          message: providerErrorMarker,
          errors: [
            {
              description: `https://provider.example/hosted?opaque=${responseMarker}`,
            },
          ],
        },
        { status: 422 }
      )
    );
    await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        yield* nexi
          .verifyPaymentOutcome({
            orderId: "order-id",
            correlationId: "correlation-id",
            amount: "5000",
            currency: "CZK",
          })
          .pipe(Effect.result);
      }).pipe(Effect.provide(Logger.layer([captureLogger]))),
      failureFetch
    );
    const failureSerialized = JSON.stringify(captured);
    expect(failureSerialized).not.toContain(providerErrorMarker);
    expect(failureSerialized).not.toContain(responseMarker);
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

  test("does not fabricate an operation ID from the provider order ID", () => {
    expect(
      getNexiPaymentMetadata({
        status: "pending",
        provider: {
          orderId: "order-id",
          captureExecuted: false,
        },
        mismatches: [],
      }).providerOperationId
    ).toBeUndefined();
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
            lastOperationType: "CAPTURE",
            authorizedAmount: "5000",
            capturedAmount: "5000",
            order: { orderId: "order-id", amount: "5000", currency: "CZK" },
          },
          operations: [
            {
              orderId: "order-id",
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
            lastOperationType: "AUTHORIZATION",
            order: { orderId: "order-id", amount: "5000", currency: "CZK" },
          },
          operations: [
            {
              orderId: "order-id",
              operationId: "authorization-id",
              operationType: "AUTHORIZATION",
              operationResult: "PENDING",
            },
          ],
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
        status: "manual_review",
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

  test("requires collective operation evidence before automatic settlement", async () => {
    const cases: ReadonlyArray<OrderResponse> = [
      {
        orderStatus: {
          lastOperationType: "CAPTURE",
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            orderId: "different-order-id",
            operationId: "capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
        ],
      },
      {
        orderStatus: {
          lastOperationType: "CAPTURE",
          authorizedAmount: "5000",
          capturedAmount: "5000",
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            orderId: "order-id",
            operationId: "capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            amount: { amount: "5000", currency: "CZK" },
            operationAmount: "7000",
            operationCurrency: "EUR",
          },
        ],
      },
      {
        orderStatus: {
          lastOperationType: "CAPTURE",
          authorizedAmount: "4000",
          capturedAmount: "5000",
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            orderId: "order-id",
            operationId: "capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
          },
        ],
      },
      {
        orderStatus: {
          lastOperationType: "REFUND",
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            operationId: "capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
        ],
      },
      ...(["REFUND", "VOID", "CANCEL"] as const).map((operationType) => ({
        orderStatus: {
          lastOperationType: operationType,
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            orderId: "order-id",
            operationId: `${operationType.toLowerCase()}-id`,
            operationType,
            operationResult:
              operationType === "REFUND"
                ? ("REFUNDED" as const)
                : operationType === "VOID"
                  ? ("VOIDED" as const)
                  : ("CANCELED" as const),
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
        ],
      })),
      {
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
          },
          {
            operationId: "untyped-later-id",
            operationResult: "REFUNDED",
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
        ],
      },
      {
        orderStatus: {
          lastOperationType: "AUTHORIZATION",
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            operationId: "capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
        ],
      },
      {
        orderStatus: {
          order: { orderId: "order-id", amount: "5000", currency: "CZK" },
        },
        operations: [
          {
            operationId: "first-capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
          {
            operationId: "second-capture-id",
            operationType: "CAPTURE",
            operationResult: "EXECUTED",
            operationAmount: "7000",
            operationCurrency: "CZK",
          },
        ],
      },
      {
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
          },
          {
            operationId: "refund-id",
            operationType: "REFUND",
            operationResult: "REFUNDED",
            operationAmount: "5000",
            operationCurrency: "CZK",
          },
        ],
      },
    ];

    for (const [index, order] of cases.entries()) {
      const result = await runWithService(
        Effect.gen(function* () {
          const nexi = yield* NexiService;
          return yield* nexi.verifyPaymentOutcome({
            orderId: "order-id",
            correlationId: "collective-evidence",
            amount: "5000",
            currency: "CZK",
          });
        }),
        mockNexiFetch(Response.json(order))
      );

      expect(result.status).toBe("manual_review");
      if (index === 0) {
        expect(result.mismatches).toContain("orderId");
      } else if (index === 1) {
        expect(result.mismatches).toContain("amount");
        expect(result.mismatches).toContain("currency");
      } else if (index === 2) {
        expect(result.mismatches).toContain("amount");
      } else {
        expect(result.mismatches).toContain("operationEvidence");
      }
    }
  });

  test("keeps conflicting provider session evidence in manual review", async () => {
    const expectedSession = randomUUID();
    const contradictorySession = randomUUID();
    const result = await runWithService(
      Effect.gen(function* () {
        const nexi = yield* NexiService;
        return yield* nexi.verifyPaymentOutcome({
          orderId: "order-id",
          correlationId: "session-evidence",
          amount: "5000",
          currency: "CZK",
          securityToken: expectedSession,
        });
      }),
      mockNexiFetch(
        Response.json({
          securityToken: expectedSession,
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
              securityToken: contradictorySession,
            },
          ],
        } satisfies OrderResponse)
      )
    );

    expect(result.status).toBe("manual_review");
    expect(result.mismatches).toContain("securityToken");
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
