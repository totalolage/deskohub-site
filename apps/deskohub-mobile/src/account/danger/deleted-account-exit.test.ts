import { describe, expect, test } from "bun:test";
import { Data, Duration, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  deletedAccountSignOutBound,
  leaveDeletedAccount,
} from "./deleted-account-exit";

class SignOutBroke extends Data.TaggedError("SignOutBroke") {}

/** Runs the exit with recorded steps, letting `elapse` pass on a test clock. */
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
  const exit = leaveDeletedAccount({
    leave: Effect.sync(() => steps.push("leave")).pipe(Effect.andThen(leave)),
    signOut: Effect.sync(() => steps.push("sign-out")).pipe(
      Effect.andThen(signOut),
      Effect.andThen(Effect.sync(() => steps.push("signed-out")))
    ),
  });
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Effect.exit(exit));
    yield* TestClock.adjust(elapse);
    return { exit: yield* Fiber.join(fiber), steps };
  }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);
};

describe("leaveDeletedAccount", () => {
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
