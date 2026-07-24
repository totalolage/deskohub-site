import { expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import type { WorkspaceE2EConfig } from "./config";
import { assertPreviewEndpointReady } from "./preview-readiness";
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

const makeConfig = (bypassSecret?: string): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret,
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});
