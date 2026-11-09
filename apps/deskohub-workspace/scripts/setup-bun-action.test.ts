import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { commandOutput, runCommand } from "./shared/command";
import { parseCompositeAction } from "./shared/workflow-contract";

const action = parseCompositeAction(
  resolve(import.meta.dir, "../../../.github/actions/setup-bun/action.yml")
);
const stepRun = (name: string): string => {
  const run = action.runs.steps.find((step) => step.name === name)?.run;
  expect(run).toBeString();
  return run ?? "";
};

const binary = "#!/bin/sh\necho 'release binary'\n";

describe("setup-bun action", () => {
  const root = mkdtempSync(join(tmpdir(), "setup-bun-action-"));
  let archiveBytes: Uint8Array;
  let archiveDigest: string;
  let release: ReturnType<typeof Bun.serve>;
  // Archive requests the fake release host fails with a 504 before it
  // answers, keyed by the URL path prefix of each scenario.
  const failuresBeforeArchive = new Map<string, number>();
  const archiveRequests = new Map<string, number>();

  beforeAll(async () => {
    mkdirSync(join(root, "archive", "bun-linux-x64"), { recursive: true });
    writeFileSync(join(root, "archive", "bun-linux-x64", "bun"), binary);
    const archive = join(root, "bun-linux-x64.zip");
    await commandOutput(["zip", "-q", "-r", archive, "bun-linux-x64"], {
      cwd: join(root, "archive"),
    });
    archiveBytes = readFileSync(archive);
    archiveDigest = createHash("sha256").update(archiveBytes).digest("hex");
    release = Bun.serve({
      port: 0,
      fetch: (request) => {
        const [, scenario = "", file] = new URL(request.url).pathname.split(
          "/"
        );
        if (file !== "bun-linux-x64.zip") {
          return new Response("not found", { status: 404 });
        }
        const requests = (archiveRequests.get(scenario) ?? 0) + 1;
        archiveRequests.set(scenario, requests);
        if (requests <= (failuresBeforeArchive.get(scenario) ?? 0)) {
          return new Response("gateway timeout", { status: 504 });
        }
        return new Response(archiveBytes);
      },
    });
  });

  afterAll(async () => {
    await release?.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  const runner = (scenario: string, arch = "X64") => {
    const home = join(root, scenario, "home");
    const runnerTemp = join(root, scenario, "runner-temp");
    mkdirSync(home, { recursive: true });
    mkdirSync(runnerTemp, { recursive: true });
    const run = (
      stepName: string,
      env: Readonly<Record<string, string>> = {}
    ) =>
      runCommand(["bash", "-c", stepRun(stepName)], {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          HOME: home,
          RUNNER_TEMP: runnerTemp,
          RUNNER_OS: "Linux",
          RUNNER_ARCH: arch,
          ...env,
        },
        timeoutMs: 60_000,
      });
    return {
      archive: join(home, ".cache", "setup-bun", "bun-linux-x64.zip"),
      installed: join(home, ".bun", "bin", "bun"),
      download: () =>
        run("Download Bun release", {
          BUN_RELEASE_URL: new URL(`/${scenario}`, release.url).href,
        }),
      install: (digest = archiveDigest) =>
        run("Install verified Bun release", { BUN_SHA256: digest }),
    };
  };

  test("retries a failing release host, then installs the verified binary", async () => {
    failuresBeforeArchive.set("flaky", 2);
    const job = runner("flaky");
    const download = await job.download();
    expect(download.exitCode).toBe(0);
    expect(archiveRequests.get("flaky")).toBe(3);

    const install = await job.install();
    expect(install.exitCode).toBe(0);
    expect(readFileSync(job.installed, "utf8")).toBe(binary);
    expect(statSync(job.installed).mode & 0o777).toBe(0o755);
  }, 60_000);

  test("installs a restored archive without downloading it", async () => {
    const job = runner("restored");
    mkdirSync(join(job.archive, ".."), { recursive: true });
    writeFileSync(job.archive, archiveBytes);
    const install = await job.install();
    expect(install.exitCode).toBe(0);
    expect(archiveRequests.get("restored")).toBeUndefined();
    expect(readFileSync(job.installed, "utf8")).toBe(binary);
  }, 60_000);

  test("refuses a restored archive that does not match the pinned digest", async () => {
    const job = runner("poisoned");
    mkdirSync(join(job.archive, ".."), { recursive: true });
    writeFileSync(job.archive, archiveBytes);
    // The workflow pins another release's digest than the archive's.
    const install = await job.install("0".repeat(64));
    expect(install.exitCode).not.toBe(0);
    expect(existsSync(job.installed)).toBe(false);
  }, 60_000);

  test("refuses to install without a pinned digest", async () => {
    const job = runner("unpinned");
    mkdirSync(join(job.archive, ".."), { recursive: true });
    writeFileSync(job.archive, archiveBytes);
    const install = await job.install("");
    expect(install.exitCode).not.toBe(0);
    expect(existsSync(job.installed)).toBe(false);
  }, 60_000);

  test("refuses a runner the pinned Linux X64 digest does not cover", async () => {
    const job = runner("arm", "ARM64");
    mkdirSync(join(job.archive, ".."), { recursive: true });
    writeFileSync(job.archive, archiveBytes);
    const install = await job.install();
    expect(install.exitCode).not.toBe(0);
    expect(existsSync(job.installed)).toBe(false);
  }, 60_000);
});
