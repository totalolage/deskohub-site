import { expect, test } from "bun:test";
import { Effect } from "effect";
import type { WorkspaceE2EConfig } from "../config";
import type { Runner } from "../runtime";
import type { WorkspaceE2EStepRunner } from "../types";
import { assertLocaleSwitcher } from "./locale";

test("switches locale from hydrated semantic links with native activation", async () => {
  const calls: Array<{ readonly args: string[]; readonly input?: string }> = [];
  let locale = "en-US";
  let focusedRef: string | undefined;
  const run: Runner = async (_command, args, options) => {
    calls.push({ args, input: options?.input });
    const command = args.slice(2);

    if (command[0] === "open") return success();
    if (command[0] === "wait") return success();
    if (command[0] === "snapshot") {
      return success(
        locale === "en-US"
          ? '- navigation "Language switcher" [ref=e1]\n  - link "CZECH" [ref=e2]'
          : '- navigation "Language switcher" [ref=e1]\n  - link "ENGLISH" [ref=e3]'
      );
    }
    if (command[0] === "focus") {
      focusedRef = command[1];
      return success();
    }
    if (command[0] === "press") {
      locale = focusedRef === "@e2" ? "cs-CZ" : "en-US";
      return success();
    }
    if (command[0] === "get" && command[1] === "url") {
      return success(`https://workspace.example/${locale}`);
    }
    if (command[0] === "eval") {
      locale = options?.input?.includes('"cs-CZ"') ? "cs-CZ" : "en-US";
      return success();
    }

    throw new Error(`Unexpected browser command: ${command.join(" ")}`);
  };
  const runStep: WorkspaceE2EStepRunner = ({ execute }) => execute;

  await Effect.runPromise(
    assertLocaleSwitcher({
      config: makeConfig(),
      run,
      runStep,
      session: "locale-test",
    })
  );

  expect(calls.some(({ args }) => args.includes("eval"))).toBe(false);
  expect(
    calls
      .filter(({ args }) => args.includes("focus"))
      .map(({ args }) => args[3])
  ).toEqual(["@e2", "@e3", "@e2", "@e3", "@e2", "@e3"]);
  expect(
    calls
      .filter(({ args }) => args.includes("press"))
      .map(({ args }) => args[3])
  ).toEqual(Array.from({ length: 6 }, () => "Enter"));

  const hydrationIndex = calls.findIndex(({ args }) => args.includes("wait"));
  const snapshotIndex = calls.findIndex(({ args }) =>
    args.includes("snapshot")
  );
  const focusIndex = calls.findIndex(({ args }) => args.includes("focus"));
  expect(hydrationIndex).toBeLessThan(snapshotIndex);
  expect(snapshotIndex).toBeLessThan(focusIndex);
});

const success = (stdout = "") => ({ exitCode: 0, stderr: "", stdout });

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://workspace.example",
  bypassSecret: undefined,
  expectedHost: "workspace.example",
});
