import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import {
  type ActionResponseOutcome,
  awaitActionQuiescence,
  retainActionSubmission,
} from "./admin-case";
import { workspaceE2ETimeoutError } from "./errors";

describe("action completion barrier", () => {
  test("deletes only after the retained action response settles", async () => {
    const operations: string[] = [];
    let releaseResponse: (() => void) | undefined;
    const responseSettled = new Promise<ActionResponseOutcome>((resolve) => {
      releaseResponse = () => resolve({ kind: "responded" });
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const barrier = yield* Effect.forkChild(
          awaitActionQuiescence({
            barrierTimeoutMs: 5_000,
            label: "initial access code action",
            responseSettled,
            waitForTerminalEvent: Effect.sync(() => {
              operations.push("converge");
              return true;
            }),
          }).pipe(Effect.andThen(Effect.sync(() => operations.push("delete"))))
        );
        // Just before its deadline the barrier still holds the deletion.
        yield* TestClock.adjust("4999 millis");
        operations.push("server-write");
        releaseResponse?.();
        yield* Fiber.join(barrier);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(operations).toEqual(["server-write", "delete"]);
  });

  test("falls back to bounded terminal convergence when the barrier times out", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
      withInstantSleeps(
        Effect.gen(function* () {
          yield* awaitActionQuiescence({
            barrierTimeoutMs: 20,
            label: "initial access code action",
            responseSettled: new Promise<ActionResponseOutcome>(() => {}),
            waitForTerminalEvent: Effect.gen(function* () {
              operations.push("converge");
              yield* Effect.sleep(5);
              operations.push("terminal");
              return true;
            }),
          });
          operations.push("delete");
        })
      )
    );

    expect(operations).toEqual(["converge", "terminal", "delete"]);
  });

  test("fails closed without deletion when the terminal event never converges", async () => {
    const operations: string[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "initial access code action",
          responseSettled: Promise.resolve({ kind: "unresolved" }),
          waitForTerminalEvent: Effect.gen(function* () {
            operations.push("converge");
            return yield* workspaceE2ETimeoutError("convergence timed out", {
              operation: "converge",
            });
          }),
        });
        operations.push("delete");
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual(["converge"]);
  });

  test("fails closed without deletion when the replay response never settles", async () => {
    const operations: string[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "replayed access code action",
          responseSettled: Promise.resolve({ kind: "unresolved" }),
        });
        operations.push("delete");
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual([]);
  });

  test("fails closed without deletion when the replay barrier times out", async () => {
    const operations: string[] = [];

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "replayed access code action",
          responseSettled: new Promise<ActionResponseOutcome>(() => {}),
        });
        operations.push("delete");
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(String(Cause.squash(exit.cause))).toContain(
      "replayed access code action response did not settle"
    );
    expect(operations).toEqual([]);
  });

  test("skips convergence when the action request was never dispatched", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 20,
          label: "save audience action",
          responseSettled: retainActionSubmission(
            Promise.reject(new Error("no request before the timeout"))
          ),
          waitForTerminalEvent: Effect.sync(() => {
            operations.push("converge");
            return true;
          }),
        });
        operations.push("delete");
      })
    );

    expect(operations).toEqual(["delete"]);
  });

  test("retains a dispatched request without a response as unresolved", async () => {
    expect(
      await retainActionSubmission(
        Promise.resolve({ response: () => Promise.resolve(null) })
      )
    ).toEqual({ kind: "unresolved" });
  });
});
