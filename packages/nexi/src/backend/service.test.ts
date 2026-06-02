import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { makeNexiRuntimeConfigLayer } from "../config";
import type { OrderResponse } from "../generated/types.gen";
import { getNexiPaymentMetadata } from "../types";
import { NexiApi } from "./api";
import { NexiService } from "./service";

const config = {
  baseUrl: "https://nexi.example.test",
  apiKey: "api-key",
  apiTimeout: 1000,
};

const runWithApi = <A, E>(
  effect: Effect.Effect<A, E, NexiService>,
  api: NexiApi
) => {
  const dependencies = Layer.merge(
    Layer.succeed(NexiApi, api),
    makeNexiRuntimeConfigLayer(config)
  );
  const serviceLayer = NexiService.Default.pipe(Layer.provide(dependencies));

  return Effect.runPromise(effect.pipe(Effect.provide(serviceLayer)));
};

describe("NexiService payment verification", () => {
  test("exposes the executed provider operation ID in payment metadata", async () => {
    const api: NexiApi = {
      _tag: "NexiApi",
      createHostedPaymentPage: mock(() =>
        Effect.die("createHostedPaymentPage not mocked")
      ),
      getOrder: mock(() =>
        Effect.succeed(
          {
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
          } satisfies OrderResponse
        )
      ),
    };

    const verification = await runWithApi(
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
      api
    );

    expect(verification.provider.operationId).toBe("operation-id");
    expect(getNexiPaymentMetadata(verification).providerOperationId).toBe(
      "operation-id"
    );
  });
});
