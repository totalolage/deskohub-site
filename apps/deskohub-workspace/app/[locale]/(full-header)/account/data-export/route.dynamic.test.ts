import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

// Defensive fresh-render guard contract: the GET handler consumes the
// dynamic connection BEFORE any downstream export work starts, so a warm
// server can never assemble a snapshot outside the requesting request
// scope. Next's route proxy already tracks plain `request.headers` access,
// so this guard is belt-and-braces rather than a demonstrated failure
// repair — the test pins the await-before-snapshot ordering regardless.
// The preview identity mismatch observed at the next exact-SHA run remains
// unresolved pending the classifier verdict; nothing here claims to repair
// it.
let connectionInvocations = 0;
let releaseConnection: (() => void) | undefined;
let globalFlagReads = 0;
const connectionGate = new Promise<void>((resolve) => {
  releaseConnection = resolve;
});
const connection = mock(() => {
  connectionInvocations += 1;
  return connectionGate;
});

// Observable downstream boundary: the export snapshot's first await is the
// accounts feature-flag read, so the mocked global flag read records when
// downstream export work has started. The default flag layers otherwise
// read `cacheLife()` inside a `"use cache"` function, which needs the
// production cacheComponents runtime, so the read is stubbed anyway.
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    areWorkspaceFeatureFlagsGlobal: async () => true,
    getGlobalWorkspaceFeatureFlagValue: async (key: string) => {
      globalFlagReads += 1;
      return key === "accounts";
    },
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

const unavailableBody = '{"error":"Account data export is unavailable."}';

// Drain deferred work deterministically: the Effect runtime and Bun both
// schedule on macrotasks, so yielding several turns lets any scheduled
// fiber start — without the connection gate the whole chain would complete.
const drainMacrotasks = async () => {
  for (let turn = 0; turn < 25; turn += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setImmediate(resolve));
  }
};

describe("account data export route dynamic rendering", () => {
  test("consumes the dynamic connection before starting downstream export work", async () => {
    expect(connectionInvocations).toBe(0);
    const pending = GET(
      new Request("https://deskohub.test/en-US/account/data-export")
    ) as Promise<Response>;

    // While the connection gate is pending, the handler must not complete
    // and no downstream export work may have started.
    const completedEarly = Symbol("completed-early");
    const outcome = await Promise.race([
      pending.then(
        () => completedEarly,
        () => completedEarly
      ),
      drainMacrotasks().then(() => "drained" as const),
    ]);
    // The discriminating observable is handler settlement, not the flag
    // read alone: `Effect.runPromise` starts the fiber eagerly here, so a
    // handler that skips the `connection()` await runs the whole export
    // chain to completion inside the bounded drain (probed: settled-early,
    // globalFlagReads 1, connectionInvocations 0), while the guarded
    // handler stays suspended on the pending connection gate for the same
    // drain (drained, globalFlagReads 0, connectionInvocations 1). The
    // flag-read assertion alone would be vacuous — Effect v4 defers fiber
    // start, so downstream reads stay 0 while the gate pends regardless.
    expect(outcome).toBe("drained");
    expect(connectionInvocations).toBe(1);
    expect(globalFlagReads).toBe(0);

    releaseConnection?.();
    const response = await pending;

    // Downstream export work starts only after the connection resolves; the
    // real default layers then fail closed in the test environment, so the
    // fixed failure body proves the closed contract still holds.
    expect(globalFlagReads).toBeGreaterThanOrEqual(1);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe(unavailableBody);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
