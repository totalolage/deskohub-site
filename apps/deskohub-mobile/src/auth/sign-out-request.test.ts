import { describe, expect, test } from "bun:test";
import { Effect, Exit, Fiber, Option, Semaphore } from "effect";
import { TestClock } from "effect/testing";
import { SessionWriteLock, withSessionWriteLock } from "./session-write-lock";
import {
  type SignOutClient,
  SignOutFailure,
  signOutOf,
  signOutRequestBound,
} from "./sign-out-request";

/** Runs `effect` on a test clock with a lock of its own. */
const onTestClock = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.provide(TestClock.layer()),
    Effect.provideService(SessionWriteLock, Semaphore.makeUnsafe(1)),
    Effect.runPromise
  );

/**
 * A sign-out client whose answer arrives when `answer` is called. Like the
 * Expo client, an abort stops only the network part: once `storing` is set
 * the answer's writes are under way and the promise settles only when
 * `answer` runs.
 */
const makeClient = () => {
  const steps: Array<string> = [];
  let answer: () => void = () => undefined;
  let signal: AbortSignal | undefined;
  const client: SignOutClient = {
    signOut: ({ fetchOptions }) =>
      new Promise((resolve) => {
        steps.push("sign-out sent");
        signal = fetchOptions.signal;
        answer = () => {
          steps.push("sign-out answered");
          resolve({ error: null });
        };
      }),
  };
  return {
    client,
    steps,
    answer: () => answer(),
    aborted: () => signal?.aborted ?? false,
  };
};

const failureOf = (exit: Exit.Exit<unknown, SignOutFailure>) =>
  Option.getOrUndefined(Exit.findErrorOption(exit));

const signIn = (steps: Array<string>) =>
  withSessionWriteLock(Effect.sync(() => steps.push("signed in")));

describe("signOutOf", () => {
  test("a sign-in waits for the sign-out's answer, which can't clear it", async () => {
    const { client, steps, answer } = makeClient();
    await onTestClock(
      Effect.gen(function* () {
        const signingOut = yield* Effect.forkChild(signOutOf(client));
        yield* Effect.yieldNow;
        const signingIn = yield* Effect.forkChild(signIn(steps));
        yield* Effect.yieldNow;
        answer();
        yield* Fiber.join(signingOut);
        yield* Fiber.join(signingIn);
      })
    );
    expect(steps).toEqual(["sign-out sent", "sign-out answered", "signed in"]);
  });

  test("waits for a sign-in storing its session before it sends", async () => {
    const { client, steps, answer } = makeClient();
    await onTestClock(
      Effect.gen(function* () {
        const lock = yield* Effect.service(SessionWriteLock);
        yield* lock.take(1);
        const signingOut = yield* Effect.forkChild(signOutOf(client));
        yield* Effect.yieldNow;
        steps.push("signed in");
        yield* lock.release(1);
        yield* Effect.yieldNow;
        answer();
        yield* Fiber.join(signingOut);
      })
    );
    expect(steps).toEqual(["signed in", "sign-out sent", "sign-out answered"]);
  });

  test("holds sign-ins until an interrupted sign-out's answer is stored", async () => {
    const { client, steps, answer, aborted } = makeClient();
    await onTestClock(
      Effect.gen(function* () {
        const signingOut = yield* Effect.forkChild(signOutOf(client));
        yield* Effect.yieldNow;
        const interrupting = yield* Effect.forkChild(
          Fiber.interrupt(signingOut)
        );
        const signingIn = yield* Effect.forkChild(signIn(steps));
        yield* Effect.yieldNow;
        expect(aborted()).toBe(true);
        expect(steps).toEqual(["sign-out sent"]);
        answer();
        yield* Fiber.join(interrupting);
        yield* Fiber.join(signingIn);
      })
    );
    expect(steps).toEqual(["sign-out sent", "sign-out answered", "signed in"]);
  });

  test("aborts a request that outlasts its bound and fails", async () => {
    const steps: Array<string> = [];
    const client: SignOutClient = {
      signOut: ({ fetchOptions }) =>
        new Promise((_resolve, reject) => {
          fetchOptions.signal.addEventListener("abort", () => {
            steps.push("aborted");
            reject(fetchOptions.signal.reason);
          });
        }),
    };
    const exit = await onTestClock(
      Effect.gen(function* () {
        const signingOut = yield* Effect.forkChild(
          Effect.exit(signOutOf(client))
        );
        yield* Effect.yieldNow;
        yield* TestClock.adjust(signOutRequestBound);
        const exit = yield* Fiber.join(signingOut);
        yield* signIn(steps);
        return exit;
      })
    );
    expect(failureOf(exit)).toBeInstanceOf(SignOutFailure);
    expect(steps).toEqual(["aborted", "signed in"]);
  });

  test("fails when the server refuses", async () => {
    const client: SignOutClient = {
      signOut: async () => ({ error: { status: 500 } }),
    };
    const exit = await onTestClock(Effect.exit(signOutOf(client)));
    expect(failureOf(exit)).toBeInstanceOf(SignOutFailure);
  });

  test("fails when the request can't be sent", async () => {
    const client: SignOutClient = {
      signOut: () => {
        throw new TypeError("Network request failed");
      },
    };
    const exit = await onTestClock(Effect.exit(signOutOf(client)));
    expect(failureOf(exit)).toBeInstanceOf(SignOutFailure);
  });
});
