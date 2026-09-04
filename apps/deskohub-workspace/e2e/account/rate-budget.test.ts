import { describe, expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import { betterAuthMagicLinkOptions } from "@/features/account/backend/auth/auth-options";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  type MagicLinkOperation,
  magicLinkOperationsPerWindow,
  magicLinkOperationWindowMs,
  makeMagicLinkRateBudget,
} from "./rate-budget";

const originalAccountWorkBudgetMs = 8 * 60_000;

type BudgetOptions = Parameters<typeof makeMagicLinkRateBudget>[0];

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

/**
 * Mutation proof for the completion-recording regression: this variant
 * records consumption at readiness time, before the supplied effect runs,
 * the old reservation timing the real budget must reject.
 */
const makeReservationTimedBudget = (options: BudgetOptions = {}) => {
  const maxPerWindow = options.maxPerWindow ?? magicLinkOperationsPerWindow;
  const windowMs = options.windowMs ?? magicLinkOperationWindowMs;
  const now = options.now ?? Date.now;
  const retryAfterNotReady =
    options.retryAfterNotReady ?? (() => Effect.sleep("1 second"));
  const states = new Map<
    MagicLinkOperation,
    { count: number; lastRequest: number }
  >();

  const isReady = (operation: MagicLinkOperation): boolean => {
    const state = states.get(operation);
    if (!state) return true;
    return now() - state.lastRequest >= windowMs || state.count < maxPerWindow;
  };

  const record = (operation: MagicLinkOperation): void => {
    const current = now();
    const state = states.get(operation);
    if (!state || current - state.lastRequest >= windowMs) {
      states.set(operation, { count: 1, lastRequest: current });
      return;
    }
    states.set(operation, { count: state.count + 1, lastRequest: current });
  };

  const run = <A, E, R>(
    operation: MagicLinkOperation,
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E, R> =>
    Effect.suspend(() =>
      isReady(operation)
        ? Effect.andThen(
            Effect.sync(() => record(operation)),
            () => effect
          )
        : Effect.andThen(retryAfterNotReady(), () => run(operation, effect))
    );

  return { run };
};

describe("magic-link rate budget", () => {
  test("derives the window from the production rate-limit window", () => {
    expect(magicLinkOperationWindowMs).toBe(
      betterAuthMagicLinkOptions.rateLimit.window * 1000
    );
    expect(magicLinkOperationWindowMs).toBeGreaterThan(0);
  });

  test("keeps exactly one request of headroom below the production maximum", () => {
    expect(magicLinkOperationsPerWindow).toBe(
      betterAuthMagicLinkOptions.rateLimit.max - 1
    );
    // A production max below two leaves the E2E budget with no usable
    // capacity: every run would wait out a full quiet window per request.
    expect(betterAuthMagicLinkOptions.rateLimit.max).toBeGreaterThanOrEqual(2);
    expect(magicLinkOperationsPerWindow).toBeGreaterThanOrEqual(1);
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

    for (let index = 0; index < magicLinkOperationsPerWindow; index++) {
      await Effect.runPromise(operate());
    }
    nowMs = magicLinkOperationWindowMs - 1;
    const startedAt = Date.now();
    const overCapacity = Effect.runPromise(operate());
    await new Promise((resolve) => setTimeout(resolve, 50));
    nowMs = magicLinkOperationWindowMs;
    await overCapacity;

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
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

  test("wait retries never advance the quiet boundary", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [100, 500_000, 600_000]),
    });

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );
    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );

    expect(sendExecutions).toEqual([0, 600_000]);
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

  test("failed effects still record consumption at completion", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [600_004, 600_005]),
    });

    clock.advanceTo(5);
    const exit = await Effect.runPromiseExit(
      budget.run("send", Effect.fail("magic-link failed" as const))
    );
    expect(Exit.isFailure(exit)).toBe(true);

    await Effect.runPromise(
      budget.run("send", probeEffect(clock, sendExecutions))
    );

    expect(sendExecutions).toEqual([600_005]);
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

  test("recording before the effect fails the completion-boundary regression", async () => {
    const clock = makeClock();
    const sendExecutions: number[] = [];
    const mutant = makeReservationTimedBudget({
      maxPerWindow: 1,
      now: clock.now,
      windowMs: 600_000,
      retryAfterNotReady: retryByAdvancingTo(clock, [600_000, 600_001]),
    });

    await Effect.runPromise(
      mutant.run(
        "send",
        Effect.sync(() => {
          clock.advanceTo(1);
          sendExecutions.push(clock.now());
        })
      )
    );
    await Effect.runPromise(
      mutant.run("send", probeEffect(clock, sendExecutions))
    );

    // The reservation-timed mutant admits at the old t=0 boundary, which the
    // completion-boundary regression above forbids.
    expect(sendExecutions).toEqual([1, 600_000]);
  });

  test("accountCase leaves the original work budget after one full rate window", () => {
    expect(workspaceE2ETimeouts.accountCase).toBeGreaterThanOrEqual(
      magicLinkOperationWindowMs + originalAccountWorkBudgetMs
    );
  });
});
