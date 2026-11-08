import { describe, expect, test } from "bun:test";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import { runToCompletion } from "./run-to-completion";

class Recorder extends Context.Service<
  Recorder,
  { readonly record: (entry: string) => Effect.Effect<void> }
>()("test/Recorder") {}

const recording = () => {
  const entries: string[] = [];
  const layer = Layer.succeed(Recorder, {
    record: (entry) => Effect.sync(() => void entries.push(entry)),
  });
  return { entries, layer };
};

describe("runToCompletion", () => {
  test("answers the effect's result", async () => {
    expect(await Effect.runPromise(runToCompletion(Effect.succeed(1)))).toBe(1);
  });

  test("finishes the effect, with the caller's services, after the caller is interrupted", async () => {
    const { entries, layer } = recording();

    await Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const caller = yield* Effect.forkChild(
        runToCompletion(
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.flatMap(Recorder, (r) => r.record("done")))
          )
        )
      );
      yield* Deferred.await(started);
      const interrupted = yield* Effect.forkChild(Fiber.interrupt(caller));
      yield* Effect.yieldNow;
      expect(entries).toEqual([]);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(interrupted);
      // The interrupted caller ends only after the effect has.
      expect(entries).toEqual(["done"]);
    }).pipe(Effect.provide(layer), Effect.runPromise);
  });

  test("lets the effect's own timeout end it", async () => {
    const result = await Effect.never.pipe(
      Effect.timeoutOrElse({
        duration: "1 millis",
        orElse: () => Effect.succeed("timed out"),
      }),
      runToCompletion,
      Effect.runPromise
    );

    expect(result).toBe("timed out");
  });
});
