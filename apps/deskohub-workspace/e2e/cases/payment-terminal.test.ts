import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { activateStatusReserveAgain } from "./payment-terminal";

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
      workspaceE2ETimeouts
    )
  );

  expect(calls.map((args) => args.slice(2))).toEqual([
    ["wait", "--fn", expect.any(String)],
    ["click", 'a[href="/en-US/checkout/order"]'],
  ]);
  expect(calls.some((args) => args.includes("eval"))).toBe(false);
});
