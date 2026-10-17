import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import {
  type ActionResponseOutcome,
  awaitActionQuiescence,
  retainActionSubmission,
  runFinalizedCase,
  sanitizedBrowserOperation,
} from "./admin-case";
import { formatWorkspaceE2EFailure, workspaceE2ETimeoutError } from "./errors";
import { type E2EOutcome, toE2EResult } from "./services/telemetry";

describe("sanitized browser failure reporting", () => {
  test("discards raw causes that can carry the session cookie, bypass, or the PIN", async () => {
    const sessionCookie = "seeded-session-token.signed-session-value";
    const bypassSecret = "raw-vercel-bypass-secret";
    const fixturePin = "1111111";
    const leakedCause = new Error(
      `request failed with headers {"cookie":"__Secure-better-auth.session_token=${sessionCookie}; _vercel_protection_bypass=${bypassSecret}",` +
        `"x-vercel-protection-bypass":"${bypassSecret}"} body pin=${fixturePin}`
    );

    const failure = await Effect.runPromise(
      Effect.flip(
        sanitizedBrowserOperation("probe the protected admin page", () =>
          Promise.reject(leakedCause)
        )
      )
    );

    expect(failure.operation).toBe("probe the protected admin page");
    expect(failure.cause).toBeUndefined();
    for (const secret of [sessionCookie, bypassSecret, fixturePin]) {
      expect(failure.message).not.toContain(secret);
      expect(formatWorkspaceE2EFailure(failure)).not.toContain(secret);
      expect(JSON.stringify(failure)).not.toContain(secret);
    }
    expect(failure.message).toBe("probe the protected admin page failed");
  });
});

describe("case finalization order", () => {
  test("marks cleanup-only failures failed, keeps them in the traced exit, and annotates once after trace finalization", async () => {
    const operations: string[] = [];
    let annotatedOutcomes: E2EOutcome[] = [];

    const exit = await Effect.runPromiseExit(
      runFinalizedCase({
        body: Effect.sync(() => {
          operations.push("body");
        }),
        cleanup: Effect.gen(function* () {
          operations.push("cleanup");
          return yield* workspaceE2ETimeoutError("cleanup timed out", {
            operation: "cleanup",
          });
        }).pipe(Effect.orDie),
        trace: (finalized) =>
          Effect.onExit(finalized, (tracedExit) =>
            Effect.sync(() => {
              operations.push("trace-finalize");
              if (!Exit.isSuccess(tracedExit)) {
                annotatedOutcomes = [
                  ...annotatedOutcomes,
                  toE2EResult(tracedExit).outcome,
                ];
              }
            })
          ),
        onExit: (settled) => {
          operations.push("annotation");
          if (!Exit.isSuccess(settled)) {
            annotatedOutcomes = [
              ...annotatedOutcomes,
              toE2EResult(settled).outcome,
            ];
          }
        },
      })
    );

    expect(Exit.isFailure(exit)).toBe(true);
    expect(operations).toEqual([
      "body",
      "cleanup",
      "trace-finalize",
      "annotation",
    ]);
    expect(annotatedOutcomes).toEqual(["failed", "failed"]);
  });
});

describe("action completion barrier", () => {
  test("deletes only after the retained action response settles", async () => {
    const operations: string[] = [];
    let releaseResponse: (() => void) | undefined;
    const responseSettled = new Promise<ActionResponseOutcome>((resolve) => {
      releaseResponse = () => resolve({ kind: "responded" });
    });

    const completed = Effect.runPromise(
      Effect.gen(function* () {
        yield* awaitActionQuiescence({
          barrierTimeoutMs: 5_000,
          label: "initial access code action",
          responseSettled,
          waitForTerminalEvent: Effect.sync(() => {
            operations.push("converge");
            return true;
          }),
        });
        operations.push("delete");
      })
    ).then(() => operations.push("done"));

    await Bun.sleep(10);
    operations.push("server-write");
    releaseResponse?.();
    await completed;

    expect(operations).toEqual(["server-write", "delete", "done"]);
  });

  test("falls back to bounded terminal convergence when the barrier times out", async () => {
    const operations: string[] = [];

    await Effect.runPromise(
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
