import { expect, test } from "bun:test";
import { Cause, Effect, Exit, Fiber } from "effect";
import {
  isWorkspaceE2ETimeout,
  tryWorkspaceE2EPromise,
  withWorkspaceE2EDiagnosticCode,
  workspaceE2EError,
  workspaceE2ETimeoutError,
} from "./errors";

test("aborts an in-flight promise when its fiber is interrupted", async () => {
  let signal: AbortSignal | undefined;

  await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        tryWorkspaceE2EPromise("wait forever", (abortSignal) => {
          signal = abortSignal;
          return new Promise<never>(() => undefined);
        })
      );
      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);
    })
  );

  expect(signal?.aborted).toBe(true);
});

test("adds a fixed diagnostic code without changing timeout classification", async () => {
  const original = workspaceE2ETimeoutError("checkout state unavailable", {
    operation: "wait for Postgres checkout state",
  });
  const exit = await Effect.runPromiseExit(
    Effect.fail(original).pipe(
      withWorkspaceE2EDiagnosticCode("postgres_checkout_row_convergence_failed")
    )
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  const error = Cause.squash(exit.cause);
  expect(error).toMatchObject({
    diagnosticCode: "postgres_checkout_row_convergence_failed",
    message: original.message,
    operation: original.operation,
    reason: "timeout",
  });
  expect(isWorkspaceE2ETimeout(error)).toBe(true);
});

test("keeps a more specific existing diagnostic code", async () => {
  const original = workspaceE2EError("webhook failed", {
    diagnosticCode: "nexi_webhook_verification_failed",
  });
  const exit = await Effect.runPromiseExit(
    Effect.fail(original).pipe(
      withWorkspaceE2EDiagnosticCode("postgres_checkout_row_convergence_failed")
    )
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  expect(Cause.squash(exit.cause)).toBe(original);
});
