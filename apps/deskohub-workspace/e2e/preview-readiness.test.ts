import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "./config";
import { assertPreviewEndpointReady } from "./preview-readiness";

test("checks webhook readiness on the exact protected preview origin", async () => {
  const requests: Array<{ headers: Headers; url: string }> = [];
  const fetch_ = (async (input: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      headers: new Headers(init?.headers),
      url: String(input),
    });
    return new Response(null, { status: 200 });
  }) as typeof fetch;

  await Effect.runPromise(
    assertPreviewEndpointReady(
      makeConfig("test-protection-bypass"),
      "/api/webhooks/nexi",
      fetch_
    )
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
});
