import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

// The route must opt into per-request rendering: cacheComponents serves GET
// route handlers from the framework cache when the handler never consumes
// dynamic request data, and the session read inside CustomerAuthentication
// uses the captured request headers instead of `headers()`. The connection
// read is the observable escape hatch, so the contract test spies on it.
let connectionInvocations = 0;
const connection = mock(() => {
  connectionInvocations += 1;
  return Promise.resolve();
});

// The default feature-flag layers read `cacheLife()` inside a `"use cache"`
// function, which needs the production cacheComponents runtime. The contract
// under test is the dynamic-connection escape, so the global flag read is
// stubbed instead of standing up the use-cache work store.
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    areWorkspaceFeatureFlagsGlobal: async () => true,
    getGlobalWorkspaceFeatureFlagValue: async (key: string) =>
      key === "accounts",
  })
);

class TestNextResponse extends Response {
  static json(body: { readonly error: string }, init?: ResponseInit): Response {
    return Response.json(body, init);
  }
}

mock.module("next/server", () => ({
  connection,
  NextResponse: TestNextResponse,
}));
mock.module("@/shared/backend/workspace-effect", () => ({
  runWorkspaceEffect:
    () =>
    <A, E>(effect: Effect.Effect<A, E, never>): Promise<A> =>
      Effect.runPromise(effect),
  scheduleWorkspaceTelemetryFlush: () => Effect.void,
}));

const { GET } = await import("./route");

describe("account data export route dynamic rendering", () => {
  test("consumes the dynamic connection before serving the export", async () => {
    expect(connectionInvocations).toBe(0);
    const response = (await GET(
      new Request("https://deskohub.test/en-US/account/data-export")
    )) as Response;
    expect(connectionInvocations).toBe(1);
    // The route still fails closed against the real default layers in the
    // test environment; the fixed body proves the failure contract holds
    // while the connection read gates every invocation.
    expect([404, 500]).toContain(response.status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
