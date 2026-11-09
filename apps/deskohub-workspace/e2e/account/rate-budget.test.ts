import { describe, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { betterAuthMagicLinkOptions } from "@/features/account/backend/auth/auth-options";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  magicLinkOperationsPerWindow,
  magicLinkOperationWindowMs,
  makeMagicLinkRateBudget,
} from "./rate-budget";

const originalAccountWorkBudgetMs = 8 * 60_000;

const makeClock = () => {
  let nowMs = 0;
  return {
    now: () => nowMs,
    advanceTo: (next: number) => {
      nowMs = next;
    },
  };
};

const probeEffect = (clock: ReturnType<typeof makeClock>, times: number[]) =>
  Effect.sync(() => {
    times.push(clock.now());
  });

/**
 * Deterministic stand-in for the default one-second retry: each not-ready
 * wait jumps the fake clock to the next queued target. Running out of
 * targets fails instead of freezing the clock in a blocked loop.
 */
const retryByAdvancingTo =
  (clock: ReturnType<typeof makeClock>, targets: number[]) => () =>
    Effect.sync(() => {
      const next = targets.shift();
      if (next === undefined) {
        throw new Error("rate-budget test retry gate exhausted");
      }
      clock.advanceTo(next);
    });

describe("magic-link rate budget", () => {
  test("waits for verification capacity before issuing an expiring link", async () => {
    const clock = makeClock();
    const sent: number[] = [];
    const verified: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [600_000]),
    });
    await Effect.runPromise(budget.run("verify", Effect.void));
    clock.advanceTo(1);
    await Effect.runPromise(budget.run("send", probeEffect(clock, sent)));
    await Effect.runPromise(budget.run("verify", probeEffect(clock, verified)));
    expect(sent).toEqual([600_000]);
    expect(verified).toEqual(sent);
  });
  test("leaves usable capacity below the production maximum", () => {
    // A production max below two leaves the E2E budget with no usable
    // capacity: every run would wait out a full quiet window per request.
    expect(betterAuthMagicLinkOptions.rateLimit.max).toBeGreaterThanOrEqual(2);
  });

  test("defaults admit exactly the derived headroom and retry every second", async () => {
    let nowMs = 0;
    const budget = makeMagicLinkRateBudget({ now: () => nowMs });
    const executions: number[] = [];
    const operate = () =>
      budget.run(
        "send",
        Effect.sync(() => {
          executions.push(nowMs);
        })
      );

    await Effect.runPromise(
      Effect.gen(function* () {
        for (let index = 0; index < magicLinkOperationsPerWindow; index++) {
          yield* operate();
        }
        nowMs = magicLinkOperationWindowMs - 1;
        const overCapacity = yield* Effect.forkChild(operate());
        yield* Effect.yieldNow;
        nowMs = magicLinkOperationWindowMs;

        yield* TestClock.adjust("999 millis");
        expect(executions).toHaveLength(magicLinkOperationsPerWindow);

        yield* TestClock.adjust("1 millis");
        yield* Fiber.join(overCapacity);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(executions).toHaveLength(magicLinkOperationsPerWindow + 1);
    expect(executions.at(-1)).toBe(magicLinkOperationWindowMs);
  });

  test("releases capacity exactly at the full quiet window after recording", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [599_999, 600_000]),
    });

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );
    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );

    expect(sendExecutions).toEqual([0, 600_000]);
  });

  test("a run that advances now before completion waits out the completion boundary", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [600_000, 600_001]),
    });

    await Effect.runPromise(
      budget.run(
        "send",
        Effect.sync(() => {
          clock.advanceTo(1);
          sendExecutions.push(clock.now());
        })
      )
    );
    expect(sendExecutions).toEqual([1]);

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );

    // The first run became ready at t=0 but recorded at completion t=1, so
    // the quiet boundary is 600_001, not the old reservation boundary
    // 600_000, which must still wait.
    expect(sendExecutions).toEqual([1, 600_001]);
  });

  test("admission captures the consumed count before the quiet boundary passes", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 4,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [1_200_000, 1_200_001]),
    });

    for (let index = 0; index < 3; index++) {
      await Effect.runPromise(
        budget.run("send", probeEffect(clock, sendExecutions))
      );
    }
    clock.advanceTo(599_999);
    await Effect.runPromise(
      budget.run(
        "send",
        Effect.sync(() => {
          clock.advanceTo(600_001);
          sendExecutions.push(clock.now());
        })
      )
    );
    expect(sendExecutions).toEqual([0, 0, 0, 600_001]);

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );

    // The fourth operation was admitted below capacity before the boundary,
    // so it consumed count 4 even though it completed after it; capacity
    // frees only one full window after its completion.
    expect(sendExecutions).toEqual([0, 0, 0, 600_001, 1_200_001]);
  });

  test("tracks send and verification budgets independently", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const verifyExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [600_000, 600_000]),
    });

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );
    await Effect.runPromise(
      budget.run("verify", probeEffect(clock, verifyExecutions))
    );
    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );
    await Effect.runPromise(
      budget.run("verify", probeEffect(clock, verifyExecutions))
    );

    expect(sendExecutions).toEqual([0, 600_000]);
    expect(verifyExecutions).toEqual([0, 600_000]);
  });

  test("interrupted effects still record consumption at completion", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [600_122, 600_123]),
    });

    // The operation effect loses this race and is interrupted at fake time
    // 123; its finalizer must record consumption there.
    await Effect.runPromise(
      Effect.race(
        budget.run("send", Effect.sleep("60 seconds")),
        Effect.sleep("5 millis").pipe(
          Effect.andThen(Effect.sync(() => clock.advanceTo(123)))
        )
      )
    );

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );

    expect(sendExecutions).toEqual([600_123]);
  });

  test("accountCase leaves the original work budget after one full rate window", () => {
    expect(workspaceE2ETimeouts.accountCase).toBeGreaterThanOrEqual(
      magicLinkOperationWindowMs + originalAccountWorkBudgetMs
    );
  });
});
