import { expect, test } from "bun:test";
import { throws } from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runBoundedProcess } from "./bounded-process";

test("kills and reaps an owned hanging child without exposing its output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-child-timeout-"));
  const startedPath = join(directory, "child-started");
  const privateOutput = "synthetic-private-child-output";
  const childSource = [
    'import { writeFileSync } from "node:fs";',
    `writeFileSync(${JSON.stringify(startedPath)}, String(process.pid));`,
    `process.stderr.write(${JSON.stringify(privateOutput)});`,
    "setInterval(() => {}, 1000);",
  ].join("\n");

  try {
    const result = await runBoundedProcess({
      cmd: [process.execPath, "-e", childSource],
      cwd: directory,
      maxOutputBytes: 1024,
      timeoutMs: 1000,
    });

    expect(result.outcome).toBe("timed-out");
    expect(result.exitCode).not.toBe(0);
    expect(JSON.stringify(result)).not.toContain(privateOutput);

    const childPid = Number(await readFile(startedPath, "utf8"));
    expect(Number.isSafeInteger(childPid)).toBe(true);
    throws(() => process.kill(childPid, 0), { code: "ESRCH" });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("kills a child that exceeds the bounded output limit without returning it", async () => {
  const privateOutput = "synthetic-private-output-sentinel";
  const childSource = [
    `process.stdout.write(${JSON.stringify(privateOutput.repeat(128))});`,
    "setInterval(() => {}, 1000);",
  ].join("\n");

  const result = await runBoundedProcess({
    cmd: [process.execPath, "-e", childSource],
    cwd: import.meta.dir,
    maxOutputBytes: 64,
    timeoutMs: 5000,
  });

  expect(result.outcome).toBe("output-limit");
  expect(result.exitCode).not.toBe(0);
  expect(JSON.stringify(result)).not.toContain(privateOutput);
});
