import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { submitDiscountCode } from "../checkout/discount-code";
import {
  assertDisplayedDiscounts,
  calendarDiscountExpectation,
} from "./discounts";

test("reads discount details from the focused trigger's accessible description", async () => {
  let focusHandlerReady = false;
  let triggerCentered = false;
  let triggerOpened = false;
  const calls: string[][] = [];
  const run: Runner = async (_command, args, options) => {
    calls.push(args);
    const [operation, value] = args.slice(2);
    if (operation === "wait" && value === "--fn") {
      const script = args.at(4) ?? "";
      focusHandlerReady =
        script.includes("__reactProps$") && script.includes('"onFocus"');
    }
    if (operation === "eval") {
      triggerCentered =
        options.input?.includes('behavior: "instant"') === true &&
        options.input.includes('block: "center"') &&
        options.input.includes("requestAnimationFrame");
    }
    if (operation === "focus") {
      if (!focusHandlerReady || !triggerCentered) {
        return {
          exitCode: 1,
          stderr: "discount trigger is not ready to receive focus",
          stdout: "",
        };
      }
      triggerOpened = true;
    }
    if (
      operation === "wait" &&
      value === "--fn" &&
      args.at(4)?.includes("aria-describedby") &&
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
      discounts: [
        calendarDiscountExpectation,
        {
          adjustment: {
            kind: "fixed",
            amount: { value: 10_000, exponent: 2, currency: "CZK" },
          },
          label: "Voucher",
          redemptionState: "redeemed",
        },
      ],
      run,
      session: "discounts-test",
    })
  );

  expect(calls.map((args) => args.at(2))).toEqual([
    "wait",
    "eval",
    "focus",
    "wait",
    "wait",
  ]);
  expect(calls.at(0)?.at(4)).toContain("data-checkout-discount-details");
  expect(calls.at(3)?.at(4)).toContain(
    "trigger?.getAttribute('aria-describedby')"
  );
  expect(calls.at(3)?.at(4)).toContain(
    "document.getElementById(descriptionId)"
  );
  expect(calls.at(3)?.at(4)).toContain('"e2e calendar sale"');
  expect(calls.at(3)?.at(4)).toContain('"20%"');
  expect(calls.at(4)?.at(4)).toContain('"voucher"');
  expect(calls.at(4)?.at(4)).toContain("CZK");
});

test("waits for the discount form submit handler before native activation", async () => {
  const calls: Array<{ readonly args: string[]; readonly input?: string }> = [];
  const run: Runner = async (_command, args, options) => {
    calls.push({ args, input: options?.input });
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    submitDiscountCode({
      code: "WORKSPACE-E2E-CODE",
      config: { timeouts: workspaceE2ETimeouts } as WorkspaceE2EConfig,
      run,
      session: "discount-code-test",
    })
  );

  const waitScript = calls.find(({ args }) => args.includes("wait"))?.args[4];
  expect(waitScript).toContain("#checkout-discount-code-form");
  expect(waitScript).toContain("#checkout-discount-code");
  expect(waitScript).toContain("__reactProps$");
  expect(waitScript).toContain('typeof reactProps?.onSubmit === "function"');
  expect(waitScript).toContain('typeof fieldProps?.onChange === "function"');
  expect(waitScript).toContain('field.type === "hidden"');
  expect(waitScript).not.toContain("data-rhf-ready");
  expect(waitScript).not.toContain('typeof reactProps?.action === "function"');
  expect(calls.map(({ args }) => args[2])).toEqual([
    "wait",
    "fill",
    "focus",
    "press",
  ]);
  expect(calls.at(-1)?.args.slice(2, 4)).toEqual(["press", "Enter"]);
});
