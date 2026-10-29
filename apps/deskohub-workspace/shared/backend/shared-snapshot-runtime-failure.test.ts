import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Effect, Layer } from "effect";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

const runtimeBuildFailure = new Error("tracing exporter unavailable");
const nextCache = recordNextCache();

// The shared runtime builds its observability layer before entering any
// Effect, so this fails every run in this file before the load starts.
mock.module("@/instrumentation", () => ({ postHogLoggerProvider: undefined }));
mock.module("./observability/workspace-tracing", () => ({
  createWorkspaceTracingLive: () =>
    Layer.effectDiscard(Effect.fail(runtimeBuildFailure)),
  WorkspaceTracingLive: Layer.effectDiscard(Effect.fail(runtimeBuildFailure)),
}));
mock.module("next/cache", () => nextCache.module);

const { readSharedSnapshot } = await import("./shared-snapshot");

let warn: ReturnType<typeof spyOn<Console, "warn">>;

beforeEach(() => {
  nextCache.clear();
  warn = spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

test("serves the fallback under the failure lifetime when the runtime cannot start", async () => {
  const load = mock(() => "loaded");

  await expect(
    readSharedSnapshot("synthetic.snapshot.load", Effect.sync(load), {
      complete: { lifetime: "minutes", tags: ["synthetic:all"] },
      failure: {
        failureCode: "synthetic.snapshot.load_failed",
        fallback: () => "fallback",
        lifetime: { stale: 30, revalidate: 60, expire: 300 },
        tags: ["synthetic:all"],
      },
    })
  ).resolves.toBe("fallback");

  expect(load).not.toHaveBeenCalled();
  expect(nextCache.calls).toEqual([
    { cacheLife: { stale: 30, revalidate: 60, expire: 300 } },
    { cacheTag: ["synthetic:all"] },
  ]);
});

test("rejects unshared without a fallback when the runtime cannot start", async () => {
  const load = mock(() => "loaded");

  await expect(
    readSharedSnapshot("synthetic.snapshot.load", Effect.sync(load), {
      complete: { lifetime: "minutes", tags: ["synthetic:all"] },
    })
  ).rejects.toBe(runtimeBuildFailure);

  expect(load).not.toHaveBeenCalled();
  expect(nextCache.calls).toEqual([{ cacheLife: { expire: 0 } }]);
});
