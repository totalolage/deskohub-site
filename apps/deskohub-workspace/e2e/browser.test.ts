import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { Effect } from "effect";
import {
  activateHydratedBrowserElement,
  captureBrowserFailureArtifacts,
  captureBrowserScreenshot,
  findEnabledSnapshotRef,
  getSnapshotRef,
  isFrameSnapshotRef,
  readActiveBrowserTabId,
  readBrowserTabs,
  switchToBrowserTab,
  waitForBrowserCondition,
} from "./browser";
import { addRedaction, type Runner } from "./runtime";
import { workspaceE2ETimeouts } from "./timeouts";

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

test("captures valid HAR after applying structured privacy redaction", async () => {
  const numericSecret = "593817";
  addRedaction(numericSecret, true);

  const root = await mkdtemp(join(tmpdir(), "workspace-e2e-har-capture-"));
  const artifactDir = join(root, "artifacts");
  const rawHar = {
    log: {
      entries: [
        {
          startedDateTime: "2025-01-01T00:00:00.000Z",
          time: 42,
          request: {
            method: "POST",
            url: "https://example.test/checkout?secret=synthetic-url-query-secret",
            headersSize: Number(numericSecret),
            headers: [
              { name: "authorization", value: "synthetic-header-secret" },
            ],
            cookies: [{ name: "session", value: "synthetic-cookie-secret" }],
            queryString: [
              { name: "code", value: "synthetic-query-string-secret" },
            ],
            postData: {
              mimeType: "application/json",
              params: [
                { name: "code", value: "synthetic-request-param-secret" },
              ],
              text: "synthetic-request-body-secret",
            },
            metadata: {
              [numericSecret]: "first-key-value",
              "[redacted]": "second-key-value",
              dynamicValue: numericSecret,
              safeNumber: 17,
              safeString: "visible-safe-value",
            },
          },
          response: {
            status: 200,
            headers: [
              { name: "set-cookie", value: "synthetic-response-header-secret" },
            ],
            cookies: [
              { name: "session", value: "synthetic-response-cookie-secret" },
            ],
            content: {
              size: 29,
              mimeType: "text/plain",
              text: "synthetic-response-body-secret",
            },
          },
        },
      ],
    },
  };
  const session = `browser-har-${randomUUID()}`;
  const run: Runner = async (_command, args) => {
    if (args[2] === "network" && args[3] === "har" && args[4] === "stop") {
      const rawHarPath = args[5];
      if (!rawHarPath) throw new Error("HAR stop path missing");
      await writeFile(rawHarPath, JSON.stringify(rawHar));
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  try {
    await Effect.runPromise(
      captureBrowserFailureArtifacts({
        artifactDir,
        cause: new Error("synthetic capture failure"),
        harStarted: true,
        run,
        session,
      })
    );

    const serialized = await readFile(join(artifactDir, "network.har"), "utf8");
    const har = JSON.parse(serialized) as {
      log: {
        entries: Array<{
          readonly request: {
            readonly cookies: unknown[];
            readonly headers: Array<{
              readonly name: string;
              readonly value: string;
            }>;
            readonly headersSize: number | string;
            readonly metadata: Record<string, unknown>;
            readonly postData: {
              readonly params: unknown[];
              readonly text: string;
            };
            readonly queryString: Array<{
              readonly name: string;
              readonly value: string;
            }>;
            readonly url: string;
          };
          readonly response: {
            readonly content: { readonly text: string };
            readonly cookies: unknown[];
            readonly headers: Array<{
              readonly name: string;
              readonly value: string;
            }>;
          };
          readonly time: number;
        }>;
      };
    };
    const entry = har.log.entries[0];
    if (!entry) throw new Error("synthetic HAR entry missing");
    const metadata = entry.request.metadata;
    const collisionValues = Object.entries(metadata)
      .filter(([key]) => key.startsWith("[redacted]"))
      .map(([, value]) => value)
      .sort();

    expect(entry.request.headersSize).toBe("[redacted]");
    expect(entry.request.metadata.safeNumber).toBe(17);
    expect(entry.request.metadata.safeString).toBe("visible-safe-value");
    expect(entry.request.metadata.dynamicValue).toBe("[redacted]");
    expect(collisionValues).toEqual(["first-key-value", "second-key-value"]);
    expect(Object.keys(metadata).join(" ")).not.toContain(numericSecret);
    expect(entry.time).toBe(42);
    expect(new URL(entry.request.url).searchParams.get("secret")).toBe(
      "[redacted]"
    );
    expect(entry.request.headers).toEqual([
      { name: "authorization", value: "[redacted]" },
    ]);
    expect(entry.request.cookies).toEqual([]);
    expect(entry.request.queryString).toEqual([
      { name: "code", value: "[redacted]" },
    ]);
    expect(entry.request.postData.params).toEqual([]);
    expect(entry.request.postData.text).toBe("[redacted]");
    expect(entry.response.headers).toEqual([
      { name: "set-cookie", value: "[redacted]" },
    ]);
    expect(entry.response.cookies).toEqual([]);
    expect(entry.response.content.text).toBe("[redacted]");
    for (const sensitiveValue of [
      numericSecret,
      "synthetic-url-query-secret",
      "synthetic-header-secret",
      "synthetic-cookie-secret",
      "synthetic-query-string-secret",
      "synthetic-request-param-secret",
      "synthetic-request-body-secret",
      "synthetic-response-header-secret",
      "synthetic-response-cookie-secret",
      "synthetic-response-body-secret",
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
