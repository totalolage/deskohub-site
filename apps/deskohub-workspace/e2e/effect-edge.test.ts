import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { runUntracedE2EEffect } from "./effect-edge";

// What `Effect.runPromise` rejects an interrupted run with.
const interruptedRejection = Cause.squash(Cause.interrupt());

// Settles with `promise`, or resolves "still pending" if it hasn't settled
// within a second.
const promptly = <A>(promise: Promise<A>) =>
  Promise.race([promise, Bun.sleep(1_000).then(() => "still pending")]);

describe("E2E Effect edge", () => {
  test("settles a run like Effect.runPromise", async () => {
    const failure = { reason: "typed failure" };

    await expect(runUntracedE2EEffect(Effect.succeed(1))).resolves.toBe(1);
    await expect(runUntracedE2EEffect(Effect.fail(failure))).rejects.toBe(
      failure
    );
    await expect(Effect.runPromise(Effect.interrupt)).rejects.toStrictEqual(
      interruptedRejection
    );
    await expect(runUntracedE2EEffect(Effect.interrupt)).rejects.toStrictEqual(
      interruptedRejection
    );
    await expect(runUntracedE2EEffect(Effect.die(failure))).rejects.toBe(
      failure
    );
  });

  test("waits for finalizers without a signal like Effect.runPromise", async () => {
    let finalized = false;

    await expect(
      runUntracedE2EEffect(
        Effect.succeed(1).pipe(
          Effect.ensuring(
            Effect.promise(() => Bun.sleep(10)).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  finalized = true;
                })
              )
            )
          )
        )
      )
    ).resolves.toBe(1);
    expect(finalized).toBe(true);
  });

  test("settles an interrupt its signal didn't cause like Effect.runPromise", async () => {
    const controller = new AbortController();

    await expect(
      runUntracedE2EEffect(Effect.interrupt, { signal: controller.signal })
    ).rejects.toStrictEqual(interruptedRejection);
    expect(controller.signal.aborted).toBe(false);
  });

  test("rejects a run its signal stopped with the signal's reason", async () => {
    const reason = new Error("case stopped");
    const before = new AbortController();
    before.abort(reason);
    let ran = false;

    await expect(
      runUntracedE2EEffect(
        Effect.sync(() => {
          ran = true;
        }),
        { signal: before.signal }
      )
    ).rejects.toBe(reason);
    expect(ran).toBe(false);

    const during = new AbortController();
    const stopped = runUntracedE2EEffect(
      Effect.never.pipe(Effect.ensuring(Effect.die("finalizer failed"))),
      { signal: during.signal }
    );
    during.abort(reason);

    await expect(stopped).rejects.toBe(reason);
  });

  test("rejects a run that recovers from its signal's interrupt", async () => {
    const reason = new Error("case stopped");
    const recovering = new AbortController();
    const recoveringRun = runUntracedE2EEffect(
      Effect.never.pipe(Effect.catchCause(() => Effect.succeed(1))),
      { signal: recovering.signal }
    );
    recovering.abort(reason);

    await expect(recoveringRun).rejects.toBe(reason);

    const synchronous = new AbortController();

    await expect(
      runUntracedE2EEffect(
        Effect.sync(() => {
          synchronous.abort(reason);
          return 1;
        }),
        { signal: synchronous.signal }
      )
    ).rejects.toBe(reason);
  });

  test("rejects an already aborted signal's reason as is", async () => {
    const defaulted = new AbortController();
    defaulted.abort();
    const withNull = new AbortController();
    withNull.abort(null);

    await expect(
      runUntracedE2EEffect(Effect.void, { signal: defaulted.signal })
    ).rejects.toBe(defaulted.signal.reason);
    expect(defaulted.signal.reason).toBeInstanceOf(DOMException);
    expect(defaulted.signal.reason.name).toBe("AbortError");
    await expect(
      runUntracedE2EEffect(Effect.void, { signal: withNull.signal })
    ).rejects.toBeNull();
  });

  test("rejects a mid-run abort without a reason with an AbortError", async () => {
    const defaulted = new AbortController();
    const defaultedRun = runUntracedE2EEffect(Effect.never, {
      signal: defaulted.signal,
    });
    defaulted.abort();

    await expect(defaultedRun).rejects.toBe(defaulted.signal.reason);

    const withNull = new AbortController();
    const withNullRun = runUntracedE2EEffect(Effect.never, {
      signal: withNull.signal,
    });
    withNull.abort(null);
    const rejection = await withNullRun.catch((cause: unknown) => cause);

    expect(rejection).toBeInstanceOf(DOMException);
    expect((rejection as DOMException).name).toBe("AbortError");
  });

  test("rejects as soon as its signal aborts, leaving finalizers in the background", async () => {
    const reason = new Error("case stopped");
    const stuck = new AbortController();
    const stuckRun = runUntracedE2EEffect(
      Effect.never.pipe(Effect.ensuring(Effect.never)),
      { signal: stuck.signal }
    );
    stuck.abort(reason);

    await expect(promptly(stuckRun)).rejects.toBe(reason);

    const unhandled: unknown[] = [];
    const onUnhandled = (cause: unknown) => unhandled.push(cause);
    process.on("unhandledRejection", onUnhandled);
    try {
      const release = Promise.withResolvers<void>();
      const finalized = Promise.withResolvers<void>();
      const slow = new AbortController();
      const slowRun = runUntracedE2EEffect(
        Effect.never.pipe(
          Effect.ensuring(
            Effect.promise(() => release.promise).pipe(
              Effect.andThen(Effect.die("finalizer failed")),
              Effect.ensuring(Effect.sync(() => finalized.resolve()))
            )
          )
        ),
        { signal: slow.signal }
      );
      slow.abort(reason);

      await expect(promptly(slowRun)).rejects.toBe(reason);
      release.resolve();
      await finalized.promise;
      await Bun.sleep(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
