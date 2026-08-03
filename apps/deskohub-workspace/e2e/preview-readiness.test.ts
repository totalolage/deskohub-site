import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "./config";
import {
  assertPreviewEndpointReady,
  assertPreviewEndpointsReady,
  assertPreviewJpegReady,
} from "./preview-readiness";
import { workspaceE2ETimeouts } from "./timeouts";

test("checks webhook readiness on the exact protected preview origin", async () => {
  const requests: Array<{ headers: Headers; url: string }> = [];
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push({
        headers: request.headers,
        url: request.url,
      });
      return new Response(null, { status: 200 });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  await Effect.runPromise(
    assertPreviewEndpointReady(
      makeConfig("test-protection-bypass"),
      "/api/webhooks/nexi"
    ).pipe(Effect.provide(httpClientLayer))
  );

  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/api/webhooks/nexi"
  );
  expect(requests[0]?.headers.get("x-vercel-protection-bypass")).toBe(
    "test-protection-bypass"
  );
});

test("checks that the generated map endpoint returns a JPEG payload", async () => {
  const fetchMock = mock(
    async () =>
      new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      })
  );

  await Effect.runPromise(
    assertPreviewJpegReady(
      makeConfig("test-protection-bypass"),
      "/workspace-location-map.jpeg"
    ).pipe(Effect.provide(makeFetchHttpClientLayer(fetchMock)))
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("starts all preview readiness requests before any request completes", async () => {
  let startedRequestCount = 0;
  let releaseRequests: () => void = () => undefined;
  const allRequestsStarted = new Promise<void>((resolve) => {
    releaseRequests = resolve;
  });
  const fetchMock = mock(async (input: URL | RequestInfo) => {
    startedRequestCount += 1;
    if (startedRequestCount === 3) releaseRequests();
    await allRequestsStarted;

    return String(input).endsWith(".jpeg")
      ? new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { "content-type": "image/jpeg" },
          status: 200,
        })
      : new Response(null, { status: 200 });
  });

  await Effect.runPromise(
    assertPreviewEndpointsReady(makeConfig()).pipe(
      Effect.provide(makeFetchHttpClientLayer(fetchMock))
    )
  );

  expect(startedRequestCount).toBe(3);
});

test("rejects an HTML error document returned by the generated map endpoint", async () => {
  const fetchMock = mock(
    async () =>
      new Response("<html>map generation failed</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })
  );

  await expect(
    Effect.runPromise(
      assertPreviewJpegReady(makeConfig(), "/workspace-location-map.jpeg").pipe(
        Effect.provide(makeFetchHttpClientLayer(fetchMock))
      )
    )
  ).rejects.toThrow("instead of image/jpeg");
});

const makeFetchHttpClientLayer = (
  fetchImplementation: typeof globalThis.fetch
) =>
  FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetchImplementation))
  );

const makeConfig = (bypassSecret?: string): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret,
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});
