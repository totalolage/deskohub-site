import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { errors as playwrightErrors } from "@playwright/test";
import { Cause, Effect, Exit } from "effect";
import {
  captureBrowserFailureArtifacts,
  findEnabledSnapshotRef,
  getSnapshotRef,
  isFrameSnapshotRef,
  waitForBrowserCondition,
} from "./browser";
import { isWorkspaceE2ETimeout } from "./errors";
import { pollUntil } from "./polling";
import { addRedaction, type Runner } from "./runtime";

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
