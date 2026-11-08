import { expect, test } from "bun:test";
import { Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { makeCeremonyRun } from "./ceremony-run";

const runtime = ManagedRuntime.make(Layer.empty);

test("starts again after a ceremony that settled before runFork returned", () => {
  const run = makeCeremonyRun(runtime);
  let runs = 0;
  const settlesAtOnce = Effect.sync(() => {
    runs += 1;
  });

  run.start(settlesAtOnce);
  run.start(settlesAtOnce);

  expect(runs).toBe(2);
});

test("ignores a start while a ceremony runs, and starts once it settled", async () => {
  const run = makeCeremonyRun(runtime);
  const release = Deferred.makeUnsafe<void>();
  let runs = 0;
  const waits = Effect.suspend(() => {
    runs += 1;
    return Deferred.await(release);
  });

  run.start(waits);
  run.start(waits);
  expect(runs).toBe(1);

  Deferred.doneUnsafe(release, Exit.void);
  await Effect.runPromise(Effect.yieldNow);
  run.start(waits);
  expect(runs).toBe(2);
});

test("interrupts the running ceremony without running its outcome", async () => {
  const run = makeCeremonyRun(runtime);
  const release = Deferred.makeUnsafe<void>();
  let outcomes = 0;

  run.start(
    Deferred.await(release).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          outcomes += 1;
        })
      )
    )
  );
  run.interrupt();
  Deferred.doneUnsafe(release, Exit.void);
  await Effect.runPromise(Effect.yieldNow);

  expect(outcomes).toBe(0);
});
