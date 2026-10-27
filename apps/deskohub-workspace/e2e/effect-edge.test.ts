import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { runUntracedE2EEffect } from "./effect-edge";

// What `Effect.runPromise` rejects an interrupted run with.
const interruptedRejection = Cause.squash(Cause.interrupt());

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

    await expect(
      runUntracedE2EEffect(Effect.never, { signal: before.signal })
    ).rejects.toBe(reason);

    const during = new AbortController();
    const stopped = runUntracedE2EEffect(
      Effect.never.pipe(Effect.ensuring(Effect.die("finalizer failed"))),
      { signal: during.signal }
    );
    during.abort(reason);

    await expect(stopped).rejects.toBe(reason);
  });
});
