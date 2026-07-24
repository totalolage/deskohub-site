import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { defaultWorkspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStepRunner } from "../types";
import { assertContactForm } from "./contact";

test("activates the hydrated contact form action through its stable selector", async () => {
  const calls: Array<{
    readonly args: string[];
    readonly input?: string;
  }> = [];
  const run: Runner = async (_command, args, options) => {
    calls.push({ args, input: options?.input });

    return {
      exitCode: 0,
      stderr: "",
      stdout: options?.input?.includes("document.body?.innerText")
        ? "Your message has been sent."
        : "",
    };
  };
  const config = {
    baseUrl:
      "https://deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app",
    bypassSecret: undefined,
    expectedHost: "deskohub-workspace-site-a1b2c3d4e-deskohub-bar.vercel.app",
    timeouts: defaultWorkspaceE2ETimeouts,
  } satisfies WorkspaceE2EConfig;
  const runStep: WorkspaceE2EStepRunner = ({ execute }) => execute;

  await Effect.runPromise(
    assertContactForm({ config, run, runStep, session: "contact-test" })
  );

  expect(
    calls.filter(({ args }) => args.includes("fill")).map(({ args }) => args[3])
  ).toEqual([
    "#contact-name",
    "#contact-phone",
    "#contact-email",
    "#contact-message",
  ]);
  const waitArgs = calls
    .find(({ args }) => args.includes("wait"))
    ?.args.slice(2);
  expect(waitArgs?.slice(0, 2)).toEqual(["wait", "--fn"]);
  expect(waitArgs?.[2]).toContain("#contact-form form");
  expect(waitArgs?.[2]).toContain("__reactProps$");
  expect(waitArgs?.[2]).toContain('typeof reactProps?.action === "function"');
  expect(calls.some(({ args }) => args.includes("click"))).toBe(false);
  expect(
    calls.find(({ args }) => args.includes("focus"))?.args.slice(2)
  ).toEqual(["focus", '#contact-form button[type="submit"]']);
  expect(calls.find(({ args }) => args.includes("press"))?.args.slice(2)).toEqual(
    ["press", "Enter"]
  );

  const waitIndex = calls.findIndex(({ args }) => args.includes("wait"));
  const focusIndex = calls.findIndex(({ args }) => args.includes("focus"));
  const pressIndex = calls.findIndex(({ args }) => args.includes("press"));
  const successWaitIndex = calls.findIndex(
    ({ args }, index) =>
      index > pressIndex &&
      args.includes("wait") &&
      args.includes("--fn") &&
      args.some((argument) => argument.includes("Your message has been sent."))
  );
  expect(waitIndex).toBeLessThan(focusIndex);
  expect(focusIndex).toBeLessThan(pressIndex);
  expect(pressIndex).toBeLessThan(successWaitIndex);
});
