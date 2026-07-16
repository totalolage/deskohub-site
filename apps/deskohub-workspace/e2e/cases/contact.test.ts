import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import { assertContactForm } from "./contact";

test("submits the contact form atomically without a stale snapshot reference", async () => {
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
    calls.some(({ input }) =>
      input?.includes("document.querySelector('#contact-form form')")
    )
  ).toBe(true);
  expect(calls.some(({ args }) => args.includes("click"))).toBe(false);
});
