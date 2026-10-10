import { expect, test } from "bun:test";
import { errors as playwrightErrors } from "@playwright/test";
import { Cause, Effect, Exit } from "effect";
import {
  activateHydratedBrowserElement,
  captureBrowserScreenshot,
  findEnabledSnapshotRef,
  getSnapshotRef,
  isFrameSnapshotRef,
  readActiveBrowserTabId,
  readBrowserTabs,
  sanitizeHarArtifact,
  switchToBrowserTab,
  waitForBrowserCondition,
} from "./browser";
import { isWorkspaceE2ETimeout } from "./errors";
import { pollUntil } from "./polling";
import { addRedaction, type Runner } from "./runtime";
import { workspaceE2ETimeouts } from "./timeouts";

test("keeps a sanitized HAR valid JSON when a short value is redacted", () => {
  addRedaction("97531", true);
  const sanitized = JSON.parse(
    sanitizeHarArtifact(
      JSON.stringify({
        log: {
          entries: [
            {
              comment: "card 97531",
              request: {
                bodySize: 97531,
                headers: [{ name: "Cookie", value: "session" }],
                postData: { params: [{ name: "pan" }], text: "97531" },
                url: "https://pay.example.test/fe/build/text/?token=abc",
              },
              response: {
                content: { text: '{"errors":[]}' },
                headers: [],
              },
              time: 5.97531,
            },
          ],
        },
      })
    )
  );
  const [entry] = sanitized.log.entries;

  expect(entry.time).toBe(5.97531);
  expect(entry.request.bodySize).toBe(97531);
  expect(entry.comment).toBe("card [redacted]");
  expect(entry.request.headers).toEqual([
    { name: "Cookie", value: "[redacted]" },
  ]);
  expect(entry.request.postData).toEqual({ params: [], text: "[redacted]" });
  expect(entry.request.url).not.toContain("abc");
  expect(entry.response.content.text).toBe("[redacted]");
});

test("keeps only the error codes of a failed Nexi hosted-field response", () => {
  const cardDataUrl = "https://xpaysandbox.nexigroup.com/fe/build/text/";
  const harEntry = (url: string, status: number, text: string) => ({
    request: { headers: [], url },
    response: { content: { text }, headers: [], status },
  });
  const sanitized = JSON.parse(
    sanitizeHarArtifact(
      JSON.stringify({
        log: {
          entries: [
            harEntry(
              cardDataUrl,
              400,
              JSON.stringify({
                errors: [
                  { code: "GW0001", description: "Jane Doe is not allowed" },
                  { code: "298" },
                  { code: "JANE" },
                ],
                event: "JANE",
                fieldStatus: [
                  { event: "BUILD_ERROR", id: "CARDHOLDER_NAME" },
                  { event: "BUILD_ERROR", id: "A1B2C3D4E5F6" },
                  { event: "1234", id: "CARD_NUMBER" },
                ],
                holder: "Jane Doe",
                pan: 4509,
                workflowState: "CARD_DATA_COLLECTION",
              })
            ),
            harEntry(cardDataUrl, 400, '"GW0001"'),
            harEntry(cardDataUrl, 400, '["298", "GW0001"]'),
            harEntry(cardDataUrl, 400, "<html>Jane Doe</html>"),
            harEntry(
              cardDataUrl,
              200,
              '{"workflowState":"CARD_DATA_COLLECTION"}'
            ),
            harEntry(
              "https://deskohub.example.test/fe/build/text/",
              400,
              '{"errors":[{"code":"GW0001"}]}'
            ),
          ],
        },
      })
    )
  );
  const [nexiFailure, ...redactedEntries] = sanitized.log.entries;

  expect(JSON.parse(nexiFailure.response.content.text)).toEqual({
    errors: [{ code: "GW0001" }],
    fieldStatus: [
      { event: "BUILD_ERROR", id: "CARDHOLDER_NAME" },
      { event: "BUILD_ERROR", id: "[other]" },
    ],
    workflowState: "CARD_DATA_COLLECTION",
  });
  for (const entry of redactedEntries)
    expect(entry.response.content.text).toBe("[redacted]");
});

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

// The runner wraps a failed command like the Playwright runtime does.
const failingWaitRunner = (failures: readonly Error[]) => {
  let calls = 0;
  const run: Runner = async (command, args) => {
    const failure = failures[calls];
    calls += 1;
    if (failure)
      throw new Error(`${command} ${args.join(" ")} failed`, {
        cause: failure,
      });
    return { exitCode: 0, stderr: "", stdout: "" };
  };
  return { calls: () => calls, run };
};

const pollBrowserCondition = (run: Runner) =>
  pollUntil(
    waitForBrowserCondition(run, "browser-test", "sale", "true", {
      timeoutMs: 5,
    }).pipe(
      Effect.as(true),
      Effect.catchIf(isWorkspaceE2ETimeout, () => Effect.succeed(undefined))
    ),
    { intervalMs: 1, label: "sale", timeoutMs: 5000 }
  );

test("retries a browser condition that hit its Playwright timeout", async () => {
  const runner = failingWaitRunner([
    new playwrightErrors.TimeoutError("Timeout 5ms exceeded."),
  ]);

  expect(await Effect.runPromise(pollBrowserCondition(runner.run))).toBe(true);
  expect(runner.calls()).toBe(2);
});

test("keeps a non-timeout browser condition failure terminal", async () => {
  const runner = failingWaitRunner([new Error("Target page closed")]);

  const exit = await Effect.runPromiseExit(pollBrowserCondition(runner.run));

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) return;
  expect(isWorkspaceE2ETimeout(Cause.squash(exit.cause))).toBe(false);
  expect(runner.calls()).toBe(1);
});

test("ignores disabled snapshot targets with additional state attributes", () => {
  const snapshot = [
    '- textbox "Card number" [disabled, ref=e1]',
    '- textbox "Card number" [ref=e2]',
  ].join("\n");

  expect(findEnabledSnapshotRef(snapshot, ["Card number"])).toBe("@e2");
});

test("accepts Playwright AI snapshot references from the main page and frames", () => {
  expect(getSnapshotRef('- button "Save" [ref=e2]')).toBe("@e2");
  expect(getSnapshotRef('- textbox "Card number" [ref=f1e4]')).toBe("@f1e4");
  expect(isFrameSnapshotRef("@e2")).toBe(false);
  expect(isFrameSnapshotRef("@f1e4")).toBe(true);
});

test("captures a screenshot through the session runner with the given path", async () => {
  const calls: Array<{ readonly args: string[]; readonly timeoutMs?: number }> =
    [];
  const run: Runner = async (_command, args, options) => {
    calls.push({ args, timeoutMs: options?.timeoutMs });
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await Effect.runPromise(
    captureBrowserScreenshot(
      run,
      "browser-test",
      "/tmp/workspace-e2e/final.png",
      { timeoutMs: workspaceE2ETimeouts.browserAction }
    )
  );

  expect(calls).toEqual([
    {
      args: [
        "--session",
        "browser-test",
        "screenshot",
        "/tmp/workspace-e2e/final.png",
      ],
      timeoutMs: workspaceE2ETimeouts.browserAction,
    },
  ]);
});

test("fails screenshot capture through the normal workspace e2e error", async () => {
  const run: Runner = async () => {
    throw new Error("screenshot failed");
  };

  const failure = await Effect.runPromise(
    captureBrowserScreenshot(
      run,
      "browser-test",
      "/tmp/workspace-e2e/final.png",
      { timeoutMs: workspaceE2ETimeouts.browserAction }
    ).pipe(Effect.flip)
  );

  expect(failure.operation).toBe("capture browser screenshot");
});

test("reads and switches stable browser tabs", async () => {
  const calls: string[][] = [];
  const run: Runner = async (_command, args) => {
    calls.push(args.slice(2));
    return {
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        data: {
          tabs: [
            { active: true, tabId: "t1" },
            { active: false, tabId: "t2" },
          ],
        },
        success: true,
      }),
    };
  };

  const tabs = await Effect.runPromise(readBrowserTabs(run, "browser-test"));
  const tabId = await Effect.runPromise(
    readActiveBrowserTabId(run, "browser-test")
  );
  await Effect.runPromise(switchToBrowserTab(run, "browser-test", tabId));

  expect(tabs).toEqual([
    { active: true, tabId: "t1" },
    { active: false, tabId: "t2" },
  ]);
  expect(tabId).toBe("t1");
  expect(calls).toEqual([
    ["--json", "tab", "list"],
    ["--json", "tab", "list"],
    ["tab", "t1"],
  ]);
});
