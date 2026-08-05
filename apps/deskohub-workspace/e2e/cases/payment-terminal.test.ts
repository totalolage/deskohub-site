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

test("releases reservation-start capacity before hosted payment", async () => {
  let insideHostedPaymentSession = false;
  const observedSteps: Array<{
    readonly capacity: "reservation-start" | undefined;
    readonly id: string;
    readonly insideHostedPaymentSession: boolean;
  }> = [];
  const orderId = "019f7082-1bec-7ab4-8fcd-2f0fdfd9dd71";
  const stop = workspaceE2EError("stop after hosted-payment step");
  const runStep = ((step) => {
    observedSteps.push({
      capacity: step.capacity,
      id: step.id,
      insideHostedPaymentSession,
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
      resources: {
        withHostedPaymentSession: (effect) =>
          Effect.acquireUseRelease(
            Effect.sync(() => {
              insideHostedPaymentSession = true;
            }),
            () => effect,
            () =>
              Effect.sync(() => {
                insideHostedPaymentSession = false;
              })
          ),
      },
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
      capacity: "reservation-start",
      id: "prepare-checkout-pay-page",
      insideHostedPaymentSession: false,
    },
    {
      capacity: undefined,
      id: "start-hosted-payment",
      insideHostedPaymentSession: true,
    },
  ]);
  expect(state.orderId).toBe(orderId);
});
