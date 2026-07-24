import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  activateHydratedBrowserElement,
  waitForBrowserCondition,
} from "./browser";
import type { Runner } from "./runtime";

test("activates a hydrated element through focus and keyboard input", async () => {
  const calls: Array<{ readonly args: string[]; readonly input?: string }> = [];
  const run: Runner = async (_command, args, options) => {
    calls.push({ args, input: options?.input });
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    activateHydratedBrowserElement(run, "browser-test", "#support-contact", {
      timeoutMs: 5000,
    })
  );

  expect(calls.map(({ args }) => args.slice(2, 4))).toEqual([
    ["wait", "--fn"],
    ["focus", "#support-contact"],
    ["press", "Enter"],
  ]);
  expect(calls[0]?.args.at(4)).toContain(
    'document.querySelector("#support-contact")'
  );
});

test("waits for an application state condition instead of sampling it once", async () => {
  const calls: Array<{ readonly args: string[] }> = [];
  const run: Runner = async (_command, args) => {
    calls.push({ args });
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  const condition = `document.querySelector("input")?.value === "restored"`;

  await Effect.runPromise(
    waitForBrowserCondition(
      run,
      "browser-test",
      "restored reservation",
      condition,
      { timeoutMs: 5000 }
    )
  );

  expect(calls.map(({ args }) => args.slice(2))).toEqual([
    ["wait", "--fn", condition],
  ]);
});
