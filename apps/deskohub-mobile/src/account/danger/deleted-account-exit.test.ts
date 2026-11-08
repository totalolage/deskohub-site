import { describe, expect, test } from "bun:test";
import { Data, Duration, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  deletedAccountSignOutBound,
  makeDeletedAccountExit,
} from "./deleted-account-exit";

class SignOutBroke extends Data.TaggedError("SignOutBroke") {}

const onTestClock = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

/** Runs one exit with recorded steps, letting `elapse` pass on a test clock. */
const runExit = ({
  leave = Effect.void,
  signOut = Effect.void,
  elapse = Duration.zero,
}: {
  readonly leave?: Effect.Effect<void>;
  readonly signOut?: Effect.Effect<void, SignOutBroke>;
  readonly elapse?: Duration.Input;
}) => {
  const steps: string[] = [];
  const exit = makeDeletedAccountExit().leave({
    leave: Effect.sync(() => steps.push("leave")).pipe(Effect.andThen(leave)),
    signOut: Effect.sync(() => steps.push("sign-out")).pipe(
      Effect.andThen(signOut),
      Effect.andThen(Effect.sync(() => steps.push("signed-out")))
    ),
  });
  return onTestClock(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(Effect.exit(exit));
      yield* TestClock.adjust(elapse);
      return { exit: yield* Fiber.join(fiber), steps };
    })
  );
};

describe("DeletedAccountExit.leave", () => {
  test("leaves, then signs out", async () => {
    const { exit, steps } = await runExit({});
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(steps).toEqual(["leave", "sign-out", "signed-out"]);
  });

  test("a failed sign-out changes nothing for the customer", async () => {
    const { exit, steps } = await runExit({
      signOut: Effect.fail(new SignOutBroke()),
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(steps).toEqual(["leave", "sign-out"]);
  });

  test("a broken sign-out changes nothing for the customer", async () => {
    const { exit, steps } = await runExit({
      signOut: Effect.die("sign-out defect"),
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(steps).toEqual(["leave", "sign-out"]);
  });

  test("still signs out when leaving breaks", async () => {
    const { exit, steps } = await runExit({
      leave: Effect.die("navigation defect"),
    });
    expect(Exit.isFailure(exit)).toBe(true);
    expect(steps).toEqual(["leave", "sign-out", "signed-out"]);
  });

  test("gives up on a sign-out request that outlasts its bound", async () => {
    const { exit, steps } = await runExit({
      signOut: Effect.never,
      elapse: deletedAccountSignOutBound,
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(steps).toEqual(["leave", "sign-out"]);
  });
});

describe("DeletedAccountExit.settled", () => {
  test("a new sign-in waits for the old sign-out's answer, which can't wipe it", async () => {
    const session: string[] = [];
    const { leave, settled } = makeDeletedAccountExit();
    const result = await onTestClock(
      Effect.gen(function* () {
        const exit = yield* Effect.forkChild(
          leave({
            leave: Effect.void,
            // The old answer arrives after 2 s and clears the stored session.
            signOut: Effect.sleep("2 seconds").pipe(
              Effect.andThen(Effect.sync(() => session.push("cleared")))
            ),
          })
        );
        yield* Effect.yieldNow;
        // The customer asks to sign in again right away.
        const signIn = yield* Effect.forkChild(
          settled.pipe(
            Effect.andThen(Effect.sync(() => session.push("new session")))
          )
        );
        yield* TestClock.adjust("1 second");
        const beforeAnswer = [...session];
        yield* TestClock.adjust("1 second");
        yield* Fiber.join(exit);
        yield* Fiber.join(signIn);
        return beforeAnswer;
      })
    );
    expect(result).toEqual([]);
    expect(session).toEqual(["cleared", "new session"]);
  });

  test("opens once the bound gives up on the sign-out", async () => {
    const { leave, settled } = makeDeletedAccountExit();
    const opened = await onTestClock(
      Effect.gen(function* () {
        yield* Effect.forkChild(
          leave({ leave: Effect.void, signOut: Effect.never })
        );
        yield* Effect.yieldNow;
        const waiting = yield* Effect.forkChild(settled);
        yield* TestClock.adjust(deletedAccountSignOutBound);
        return yield* Fiber.join(waiting);
      })
    );
    expect(opened).toBeUndefined();
  });

  test("is open while no exit runs", async () => {
    const { settled } = makeDeletedAccountExit();
    expect(await onTestClock(settled)).toBeUndefined();
  });
});
