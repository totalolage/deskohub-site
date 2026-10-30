import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestResult } from "@playwright/test/reporter";
import PlaywrightTraceReporter from "./playwright-trace-reporter";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "trace-reporter-"));
});

afterEach(async () => {
  await rm(directory, { force: true, recursive: true });
});

test("drops the attachment of a trace it had to delete", async () => {
  const output = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const path = join(directory, "trace.zip");
    await writeFile(path, "not a zip");
    const result: Pick<TestResult, "attachments"> = {
      attachments: [{ contentType: "application/zip", name: "trace", path }],
    };

    new PlaywrightTraceReporter({ origins: [] }).onTestEnd(
      { titlePath: () => ["webkit", "temporal"] },
      result
    );

    expect(result.attachments).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
    expect(output).toHaveBeenCalledTimes(1);
  } finally {
    output.mockRestore();
  }
});

test("deletes traces no test reported, leaving sanitized ones and Playwright's working folders", async () => {
  const output = spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    const testDirectory = join(directory, "temporal-webkit");
    const working = join(directory, ".playwright-artifacts-0", "traces");
    await mkdir(testDirectory, { recursive: true });
    await mkdir(working, { recursive: true });
    await writeFile(join(testDirectory, "trace.zip"), "raw");
    await writeFile(join(testDirectory, "trace-1.zip"), "raw");
    await writeFile(join(testDirectory, "sanitized-trace.zip"), "clean");
    await writeFile(join(working, "trace.zip"), "live");
    const reporter = new PlaywrightTraceReporter({ origins: [] });

    reporter.onBegin({ projects: [{ outputDir: directory }] });
    reporter.onEnd();

    expect((await readdir(testDirectory)).sort()).toEqual([
      "sanitized-trace.zip",
    ]);
    expect(await readdir(working)).toEqual(["trace.zip"]);
    expect(output).toHaveBeenCalledTimes(2);
  } finally {
    output.mockRestore();
  }
});
