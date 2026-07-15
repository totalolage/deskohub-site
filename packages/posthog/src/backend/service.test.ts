import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Redacted } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PostHogConfig } from "../config";
import { PostHogService } from "./service";

const runWithService = <A, E>(
  effect: Effect.Effect<A, E, PostHogService>,
  fetchImplementation: typeof globalThis.fetch
) => {
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImplementation))
  );
  const configLayer = Layer.succeed(PostHogConfig, {
    apiKey: Redacted.make("feature-flag-api-key"),
    host: new URL("https://eu.posthog.test"),
  });
  const serviceLayer = PostHogService.Live.pipe(
    Layer.provide(Layer.merge(configLayer, httpClientLayer))
  );

  return Effect.runPromise(effect.pipe(Effect.provide(serviceLayer)));
};

describe("PostHogService", () => {
  test("uses the generated client with the configured host and authentication", async () => {
    const requests: Request[] = [];
    const fetchImplementation = mock(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request =
          input instanceof Request ? input : new Request(input, init);
        requests.push(request);
        return Response.json({
          count: 0,
          next: null,
          previous: null,
          results: [],
        });
      }
    ) as unknown as typeof globalThis.fetch;

    const page = await runWithService(
      Effect.gen(function* () {
        const postHog = yield* PostHogService;
        return yield* postHog.listFeatureFlags({
          archived: "false",
          limit: 100,
          offset: 0,
          projectId: "12345",
        });
      }),
      fetchImplementation
    );

    expect(page).toEqual({
      count: 0,
      next: null,
      previous: null,
      results: [],
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const url = new URL(request.url);
    expect(url.origin).toBe("https://eu.posthog.test");
    expect(url.pathname).toBe("/api/projects/12345/feature_flags/");
    expect(url.searchParams.get("archived")).toBe("false");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(request.headers.get("Authorization")).toBe(
      "Bearer feature-flag-api-key"
    );
  });

  test("does not expose provider response bodies in errors", async () => {
    const fetchImplementation = mock(
      async () => new Response("private provider details", { status: 403 })
    ) as unknown as typeof globalThis.fetch;

    const request = Effect.gen(function* () {
      const postHog = yield* PostHogService;
      return yield* postHog.listFeatureFlags({ projectId: "12345" });
    });

    await expect(runWithService(request, fetchImplementation)).rejects.toThrow(
      "PostHog feature flag request failed with status 403."
    );
    await expect(
      runWithService(request, fetchImplementation)
    ).rejects.not.toThrow("private provider details");
  });
});
