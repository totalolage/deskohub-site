import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import type { WorkspaceE2EStepRunner } from "../types";
import { assertContactForm } from "./contact";

test("clicks the hydrated contact form button from a fresh semantic snapshot", async () => {
  const calls: Array<{
    readonly args: string[];
    readonly input?: string;
  }> = [];
  const run: Runner = async (_command, args, options) => {
    calls.push({ args, input: options?.input });

    if (args.includes("snapshot")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: '- button "Send message" [ref=e1]',
      };
    }

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
  expect(waitArgs?.[2]).toContain("#contact-form button");
  expect(waitArgs?.[2]).toContain("submit");
  expect(waitArgs?.[2]).toContain("__reactProps$");
  expect(
    calls.find(({ args }) => args.includes("click"))?.args.slice(2)
  ).toEqual(["click", "@e1"]);
  expect(calls.some(({ args }) => args.includes("press"))).toBe(false);

  const waitIndex = calls.findIndex(({ args }) => args.includes("wait"));
  const snapshotIndex = calls.findIndex(({ args }) =>
    args.includes("snapshot")
  );
  const clickIndex = calls.findIndex(({ args }) => args.includes("click"));
  const successWaitIndex = calls.findIndex(
    ({ args }, index) =>
      index > clickIndex &&
      args.includes("wait") &&
      args.includes("--fn") &&
      args.some((argument) => argument.includes("Your message has been sent."))
  );
  expect(waitIndex).toBeLessThan(snapshotIndex);
  expect(snapshotIndex).toBeLessThan(clickIndex);
  expect(clickIndex).toBeLessThan(successWaitIndex);
});
