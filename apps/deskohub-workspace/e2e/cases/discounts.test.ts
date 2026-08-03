import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  assertDisplayedDiscounts,
  calendarDiscountExpectation,
} from "./discounts";

test("waits for the discount trigger to hydrate before hovering it", async () => {
  let triggerHydrated = false;
  let triggerOpened = false;
  const calls: string[][] = [];
  const run: Runner = async (_command, args) => {
    calls.push(args);
    const [operation, value] = args.slice(2);
    if (operation === "wait" && value === "--fn") {
      triggerHydrated = args.at(4)?.includes("__reactProps$") ?? false;
    }
    if (operation === "hover" && !triggerHydrated) {
      return {
        exitCode: 1,
        stderr: "discount trigger is not hydrated",
        stdout: "",
      };
    }
    if (operation === "hover") triggerOpened = true;
    if (
      operation === "wait" &&
      value === "--fn" &&
      args.at(4)?.includes('[role="tooltip"]') &&
      !triggerOpened
    ) {
      return {
        exitCode: 1,
        stderr: "discount tooltip is not open",
        stdout: "",
      };
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    assertDisplayedDiscounts({
      config: {
        timeouts: workspaceE2ETimeouts,
      } as WorkspaceE2EConfig,
      discounts: [calendarDiscountExpectation],
      run,
      session: "discounts-test",
    })
  );

  expect(calls.map((args) => args.at(2))).toEqual(["wait", "hover", "wait"]);
  expect(calls.at(2)?.at(4)).toContain(
    "document.querySelectorAll('[role=\"tooltip\"] li')"
  );
  expect(calls.at(2)?.at(4)).toContain('"e2e calendar sale"');
  expect(calls.at(2)?.at(4)).toContain('"20%"');
});
