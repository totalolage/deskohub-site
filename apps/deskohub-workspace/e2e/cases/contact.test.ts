import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { assertContactForm } from "./contact";

test("submits the hydrated contact form from a fresh semantic snapshot", async () => {
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
    alias: "workspace.example.com",
    aliasUrl: "https://workspace.example.com",
    browserUrl: "https://workspace.example.com",
    bypassSecret: undefined,
    vercelProjectId: "project",
    vercelTeamId: "team",
    vercelToken: "token",
  } satisfies WorkspaceE2EConfig;

  await Effect.runPromise(
    assertContactForm({ config, run, session: "contact-test" })
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
    calls.find(({ args }) => args.includes("focus"))?.args.slice(2)
  ).toEqual(["focus", "@e1"]);
  expect(
    calls.find(({ args }) => args.includes("press"))?.args.slice(2)
  ).toEqual(["press", "Enter"]);

  const waitIndex = calls.findIndex(({ args }) => args.includes("wait"));
  const snapshotIndex = calls.findIndex(({ args }) =>
    args.includes("snapshot")
  );
  const focusIndex = calls.findIndex(({ args }) => args.includes("focus"));
  expect(waitIndex).toBeLessThan(snapshotIndex);
  expect(snapshotIndex).toBeLessThan(focusIndex);
});
