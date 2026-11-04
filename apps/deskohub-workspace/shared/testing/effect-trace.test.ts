import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { recordEffectTrace, startEffectTrace } from "./effect-trace.test-utils";

class ProbeError extends Error {}

describe("recordEffectTrace", () => {
  test("records spans, logs with fields and annotations, and calls in order", async () => {
    const trace = startEffectTrace();
    const ledger = trace.recordCalls("ledger", {
      mark: (_input: { readonly id: string; readonly at: Date }) =>
        Effect.succeed("marked"),
      find: (_id: string, _limit: number) => Effect.succeed(null),
    });

    const exit = await Effect.runPromise(
      recordEffectTrace(
        trace,
        Effect.fn("probe.outer")(function* () {
          yield* Effect.logDebug("started");
          yield* ledger.find("order-id", 2);
          const marked = yield* ledger
            .mark({ id: "order-id", at: new Date(0) })
            .pipe(Effect.annotateLogs({ orderId: "order-id" }));
          yield* Effect.logWarning("marked", {
            reason: "stale",
            cause: new ProbeError("boom"),
            count: 1,
          }).pipe(Effect.annotateLogs({ orderId: "order-id" }));
          yield* Effect.logError("plain", ["listed"], 7);
          return marked;
        })()
      )
    );

    expect(exit).toEqual(Exit.succeed("marked"));
    expect(trace.entries).toEqual([
      "span probe.outer",
      "Debug started {} in probe.outer",
      "call ledger.find(order-id; 2)",
      "call ledger.mark(id=order-id, at=<Date>)",
      "Warn marked (reason=stale, cause=<ProbeError>, count=1) {orderId} in probe.outer",
      "Error plain (<Array>) (7) {} in probe.outer",
    ]);
  });

  test("keeps a failure in the returned exit and records logs outside any span", async () => {
    const trace = startEffectTrace();

    const exit = await Effect.runPromise(
      recordEffectTrace(
        trace,
        Effect.logInfo("before failure").pipe(
          Effect.andThen(Effect.fail("failed" as const))
        )
      )
    );

    expect(exit).toEqual(Exit.fail("failed"));
    expect(trace.entries).toEqual(["Info before failure {} in -"]);
  });
});
