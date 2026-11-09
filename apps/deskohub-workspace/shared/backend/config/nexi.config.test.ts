import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  NexiCorrelationIdSchema,
  NexiOrderIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { type Duration, Effect, Exit, Fiber, Schema } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import type { env } from "@/env";
import { makeWorkspaceNexiLayer } from "./nexi.config";

/**
 * Requests a hosted payment page from the configured client while Nexi
 * answers only once `answerAfter` has passed on the test clock.
 */
const requestHostedPageAnsweredAfter = (
  deploymentEnvironment: (typeof env)["VERCEL_ENV"],
  answerAfter: Duration.Input
) =>
  Effect.gen(function* () {
    let answer: ((response: Response) => void) | undefined;
    const fetch = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        answer = resolve;
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason)
        );
      });

    const nexi = yield* NexiService;
    const request = yield* Effect.forkChild(
      nexi
        .createHostedPaymentPage({
          orderId: Schema.decodeUnknownSync(NexiOrderIdSchema)("order-id"),
          correlationId: Schema.decodeUnknownSync(NexiCorrelationIdSchema)(
            "correlation-id"
          ),
          amount: "5000",
          currency: "CZK",
          locale: "en-US",
          resultUrl: "https://example.test/result",
          cancelUrl: "https://example.test/cancel",
          notificationUrl: "https://example.test/webhook",
        })
        .pipe(Effect.provideService(FetchHttpClient.Fetch, fetch))
    );
    yield* TestClock.adjust(answerAfter);
    expect(answer).toBeDefined();
    answer?.(
      Response.json({
        hostedPage: "https://pay.example.test",
        securityToken: "security-token",
      })
    );
    return yield* Fiber.await(request);
  }).pipe(
    Effect.provide(makeWorkspaceNexiLayer(deploymentEnvironment)),
    Effect.provide(TestClock.layer()),
    Effect.runPromise
  );

describe("Workspace Nexi client", () => {
  test("times a production request out at 5 seconds", async () => {
    const exit = await requestHostedPageAnsweredAfter(
      "production",
      "5 seconds"
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(exit).toMatchObject({
      cause: {
        reasons: [
          {
            error: {
              _tag: "NetworkError",
              message: "Failed to connect to Nexi",
            },
          },
        ],
      },
    });
  });

  for (const deploymentEnvironment of ["preview"] as const) {
    test(`accepts a ${deploymentEnvironment} response that arrives after 5 seconds`, async () => {
      const exit = await requestHostedPageAnsweredAfter(
        deploymentEnvironment,
        "29 seconds"
      );

      expect(exit).toEqual(
        Exit.succeed({
          orderId: Schema.decodeUnknownSync(NexiOrderIdSchema)("order-id"),
          hostedPage: "https://pay.example.test",
          securityToken: "security-token",
        })
      );
    });

    test(`times a ${deploymentEnvironment} request out at 30 seconds`, async () => {
      const exit = await requestHostedPageAnsweredAfter(
        deploymentEnvironment,
        "30 seconds"
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });
  }
});
