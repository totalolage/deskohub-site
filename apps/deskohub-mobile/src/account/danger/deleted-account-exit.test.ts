import { describe, expect, test } from "bun:test";
import { Data, Effect } from "effect";
import { leaveDeletedAccount } from "./deleted-account-exit";

class SignOutBroke extends Data.TaggedError("SignOutBroke") {}

const recordExit = (signOut: Effect.Effect<void, SignOutBroke>) => {
  const steps: string[] = [];
  const exit = leaveDeletedAccount({
    signOut: Effect.andThen(
      Effect.sync(() => steps.push("sign-out")),
      signOut
    ),
    leave: Effect.sync(() => {
      steps.push("leave");
    }),
  });
  return { steps, exit };
};

describe("leaveDeletedAccount", () => {
  test("signs out, then leaves", async () => {
    const { steps, exit } = recordExit(Effect.void);
    await Effect.runPromise(exit);
    expect(steps).toEqual(["sign-out", "leave"]);
  });

  test("still leaves when the sign-out request fails", async () => {
    const { steps, exit } = recordExit(Effect.fail(new SignOutBroke()));
    await Effect.runPromise(exit);
    expect(steps).toEqual(["sign-out", "leave"]);
  });

  test("still leaves when the sign-out breaks", async () => {
    const { steps, exit } = recordExit(Effect.die("sign-out defect"));
    await Effect.runPromise(exit);
    expect(steps).toEqual(["sign-out", "leave"]);
  });

  test("leaves only after the sign-out settles", async () => {
    const steps: string[] = [];
    const exit = leaveDeletedAccount({
      signOut: Effect.sleep("10 millis").pipe(
        Effect.andThen(Effect.sync(() => steps.push("signed-out")))
      ),
      leave: Effect.sync(() => {
        steps.push("leave");
      }),
    });
    await Effect.runPromise(exit);
    expect(steps).toEqual(["signed-out", "leave"]);
  });
});
