import { expect, test } from "bun:test";
import { Effect, Exit } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type {
  CheckoutData,
  CheckoutFlowState,
  WorkspaceE2EStepRunner,
} from "../types";
import {
  activateStatusReserveAgain,
  assertPaymentTerminalPath,
} from "./payment-terminal";

test("restarts a reservation through a hydrated stable link selector", async () => {
  const calls: string[][] = [];
  const run: Runner = async (_command, args) => {
    calls.push(args);
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    activateStatusReserveAgain(
      run,
      "payment-terminal",
      "/en-US/reservation/cowork",
      workspaceE2ETimeouts
    )
  );

  expect(calls.map((args) => args.slice(2))).toEqual([
    ["wait", "--fn", expect.any(String)],
    ["focus", 'a[href="/en-US/reservation/cowork"]'],
    ["press", "Enter"],
  ]);
  expect(calls.some((args) => args.includes("eval"))).toBe(false);
});

test("starts hosted payment only after reservation preparation", async () => {
  const observedSteps: Array<{
    readonly capacity: "provider-verification" | undefined;
    readonly id: string;
  }> = [];
  const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
  const stop = workspaceE2EError("stop after hosted-payment step");
  const runStep = ((step) => {
    observedSteps.push({
      capacity: step.capacity,
      id: step.id,
    });
    return step.id === "prepare-checkout-pay-page"
      ? Effect.succeed(orderId)
      : Effect.fail(stop);
  }) as WorkspaceE2EStepRunner;
  const data = {} as CheckoutData;
  const state: CheckoutFlowState = { data };

  const exit = await Effect.runPromiseExit(
    assertPaymentTerminalPath({
      config: { timeouts: workspaceE2ETimeouts } as WorkspaceE2EConfig,
      data,
      reservationPath: "/en-US/reservation/cowork",
      run: (() =>
        Promise.reject(new Error("runner must not execute"))) as Runner,
      runStep,
      scenario: {
        providerStatus: "DECLINED",
        state: "failed",
        titlePattern: /failed/,
      },
      session: "payment-terminal-capacity",
      state,
      submitReservationScript: "unused",
    }) as Effect.Effect<void, typeof stop>
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(observedSteps).toEqual([
    {
      capacity: undefined,
      id: "prepare-checkout-pay-page",
    },
    {
      capacity: undefined,
      id: "start-hosted-payment",
    },
  ]);
  expect(state.orderId).toBe(orderId);
});
