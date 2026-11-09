import { describe, expect, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import { withE2ERuntime } from "./runtime-fixture";

class TestPool extends Context.Service<TestPool, { readonly id: number }>()(
  "TestPool"
) {}

const makeTestPoolLayer = (events: string[]) => {
  let opened = 0;
  return Layer.effect(
    TestPool,
    Effect.acquireRelease(
      Effect.sync(() => {
        opened += 1;
        events.push(`open ${opened}`);
        return TestPool.of({ id: opened });
      }),
      () =>
        Effect.sync(() => {
          events.push("close");
        }).pipe(Effect.withSpan("test-pool-close"))
    )
  );
};

const readPoolId = Effect.gen(function* () {
  return (yield* TestPool).id;
});

type ExportedSpan = {
  readonly name: string;
  readonly parentSpanId?: string;
  readonly traceId: string;
};

type OtlpTraceRequest = {
  readonly resourceSpans?: readonly {
    readonly scopeSpans?: readonly {
      readonly spans?: readonly ExportedSpan[];
    }[];
  }[];
};

/** A local OTLP endpoint standing in for PostHog, recording every span. */
const serveTraceSink = () => {
  const spans: ExportedSpan[] = [];
  const server = Bun.serve({
    fetch: async (request) => {
      const body = (await request.json()) as OtlpTraceRequest;
      for (const resource of body.resourceSpans ?? []) {
        for (const scope of resource.scopeSpans ?? []) {
          spans.push(...(scope.spans ?? []));
        }
      }
      return Response.json({});
    },
    hostname: "127.0.0.1",
    port: 0,
  });
  return { server, spans };
};

describe("withE2ERuntime", () => {
  test("builds the layer once for every run and releases it after use settles", async () => {
    const events: string[] = [];

    const ids = await withE2ERuntime(
      { layer: makeTestPoolLayer(events) },
      async (runEffect) => {
        const runs = [await runEffect(readPoolId), await runEffect(readPoolId)];
        expect(events).toEqual(["open 1"]);
        return runs;
      }
    );

    expect(ids).toEqual([1, 1]);
    expect(events).toEqual(["open 1", "close"]);
  });

  test("releases the layer when use fails", async () => {
    const events: string[] = [];

    await expect(
      withE2ERuntime(
        { layer: makeTestPoolLayer(events) },
        async (runEffect) => {
          await runEffect(readPoolId);
          throw new Error("the fixture's test failed");
        }
      )
    ).rejects.toThrow("the fixture's test failed");

    expect(events).toEqual(["open 1", "close"]);
  });

  test("builds nothing for a worker that never runs an effect", async () => {
    const events: string[] = [];

    await withE2ERuntime({ layer: makeTestPoolLayer(events) }, async () => {});

    expect(events).toEqual([]);
  });

  test("parents runs on the trace parent and exports finalizer spans before the export shuts down", async () => {
    const traceId = "0123456789abcdef0123456789abcdef";
    const parentSpanId = "0123456789abcdef";
    const sink = serveTraceSink();
    try {
      await withE2ERuntime(
        {
          layer: makeTestPoolLayer([]),
          tracing: makeTestE2EEnvironment({
            WORKSPACE_E2E_POSTHOG_HOST: sink.server.url.origin,
            WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN: "phc_test",
            WORKSPACE_E2E_TRACE_PARENT: `00-${traceId}-${parentSpanId}-01`,
          }),
        },
        (runEffect) =>
          runEffect(readPoolId.pipe(Effect.withSpan("test-pool-read")))
      );
    } finally {
      await sink.server.stop(true);
    }

    expect(sink.spans.find((span) => span.name === "test-pool-read")).toEqual(
      expect.objectContaining({ parentSpanId, traceId })
    );
    expect(sink.spans.map((span) => span.name)).toContain("test-pool-close");
  });
});
