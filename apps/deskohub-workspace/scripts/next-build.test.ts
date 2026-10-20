import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (condition: () => boolean): Promise<boolean> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    if (condition()) return true;
    await Bun.sleep(20);
  }
  return false;
};

/**
 * A stand-in `next` on PATH: it records each invocation's arguments,
 * whether its after-compile hook is deferred, and its mimalloc purge delay,
 * exits with `NEXT_FAIL_EXIT` in the `NEXT_FAIL_MODE` build mode, and in the
 * `NEXT_HANG_MODE` build mode starts a worker, records both pids, and waits.
 */
const fakeNext = `#!/usr/bin/env bash
echo "next $*\${WORKSPACE_NEXT_BUILD_DEFERS_AFTER_COMPILE:+ (hook deferred)}\${MIMALLOC_PURGE_DELAY:+ (purge delay $MIMALLOC_PURGE_DELAY)}" >> "$NEXT_CALLS"
case "$*" in *"build-mode=\${NEXT_FAIL_MODE:-none}"*) exit "$NEXT_FAIL_EXIT" ;; esac
case "$*" in *"build-mode=\${NEXT_HANG_MODE:-none}"*) sleep 30 & echo "$$ $!" > "$NEXT_PID"; wait ;; esac
`;

/**
 * The project's Next config, wrapped like the Workspace's, whose
 * after-compile hook records the metadata it gets and fails or hangs like the
 * stand-in `next` when its mode is `after-compile`.
 */
const fixtureConfig = `import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { withDeferrableAfterCompile } from ${JSON.stringify(join(import.meta.dir, "next-build-after-compile.mjs"))};

export default withDeferrableAfterCompile(async () => ({
  compiler: {
    runAfterProductionCompile: async ({ distDir, projectDir }) => {
      const ownDistDir = distDir === projectDir + "/.next";
      appendFileSync(
        process.env.NEXT_CALLS,
        "hook " + (ownDistDir ? "with" : "without") + " the project's distDir\\n"
      );
      if (process.env.NEXT_FAIL_MODE === "after-compile") {
        process.exit(Number(process.env.NEXT_FAIL_EXIT));
      }
      if (process.env.NEXT_HANG_MODE === "after-compile") {
        const worker = spawn("sleep", ["30"], { stdio: "ignore" });
        writeFileSync(process.env.NEXT_PID, \`\${process.pid} \${worker.pid}\`);
        await new Promise(() => undefined);
      }
    },
  },
}));
`;

const startBuild = (
  directory: string,
  env: Readonly<Record<string, string>> = {},
  args: readonly string[] = []
) => {
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "next"), fakeNext, { mode: 0o755 });
  writeFileSync(join(directory, "next.config.mjs"), fixtureConfig);
  return Bun.spawn({
    cmd: [process.execPath, join(import.meta.dir, "next-build.ts"), ...args],
    cwd: directory,
    env: {
      NEXT_CALLS: join(directory, "calls"),
      NEXT_PID: join(directory, "pid"),
      PATH: `${bin}:${process.env.PATH}`,
      ...env,
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
};

const calls = (directory: string): readonly string[] =>
  existsSync(join(directory, "calls"))
    ? readFileSync(join(directory, "calls"), "utf8").trim().split("\n")
    : [];

const compile =
  "next build --turbo --experimental-build-mode=compile (hook deferred) (purge delay 0)";
const hook = "hook with the project's distDir";
const generate =
  "next build --turbo --experimental-build-mode=generate (purge delay 0)";

describe("next-build", () => {
  let directory = "";
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "next-build-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("compiles, runs the after-compile hook, then generates", async () => {
    const build = startBuild(directory);
    expect(await build.exited).toBe(0);
    expect(calls(directory)).toEqual([compile, hook, generate]);
  });

  test("passes other arguments to both next builds", async () => {
    const build = startBuild(directory, {}, ["--debug"]);
    expect(await build.exited).toBe(0);
    expect(calls(directory)).toEqual([
      "next build --turbo --experimental-build-mode=compile --debug (hook deferred) (purge delay 0)",
      hook,
      "next build --turbo --experimental-build-mode=generate --debug (purge delay 0)",
    ]);
  });

  test("runs an explicit build mode once, with its own hook", async () => {
    const build = startBuild(directory, {}, [
      "--experimental-build-mode",
      "compile",
    ]);
    expect(await build.exited).toBe(0);
    expect(calls(directory)).toEqual([
      "next build --turbo --experimental-build-mode compile (purge delay 0)",
    ]);
  });

  test("a failed compile fails the build without generating", async () => {
    const build = startBuild(directory, {
      NEXT_FAIL_EXIT: "3",
      NEXT_FAIL_MODE: "compile",
    });
    expect(await build.exited).toBe(3);
    expect(await new Response(build.stderr).text()).toContain(
      "--experimental-build-mode=compile` exited with 3"
    );
    expect(calls(directory)).toEqual([compile]);
  });

  test("a failed after-compile hook fails the build without generating", async () => {
    const build = startBuild(directory, {
      NEXT_FAIL_EXIT: "5",
      NEXT_FAIL_MODE: "after-compile",
    });
    expect(await build.exited).toBe(5);
    expect(calls(directory)).toEqual([compile, hook]);
  });

  test("a failed generate fails the build", async () => {
    const build = startBuild(directory, {
      NEXT_FAIL_EXIT: "4",
      NEXT_FAIL_MODE: "generate",
    });
    expect(await build.exited).toBe(4);
    expect(calls(directory)).toEqual([compile, hook, generate]);
  });

  test("a phase ended by a signal exits with its shell status", async () => {
    const build = startBuild(directory, { NEXT_HANG_MODE: "generate" });
    const pidFile = join(directory, "pid");
    try {
      expect(await waitFor(() => existsSync(pidFile))).toBe(true);
      const [nextPid] = readFileSync(pidFile, "utf8").trim().split(" ");
      process.kill(Number(nextPid), "SIGKILL");
      expect(await build.exited).toBe(137);
    } finally {
      build.kill("SIGKILL");
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const mode of ["compile", "after-compile", "generate"] as const) {
      test(`${signal} to the runner ends its ${mode} phase and its workers`, async () => {
        const build = startBuild(directory, { NEXT_HANG_MODE: mode });
        const pidFile = join(directory, "pid");
        let pids: readonly number[] = [];
        try {
          expect(
            await waitFor(
              () =>
                existsSync(pidFile) &&
                readFileSync(pidFile, "utf8").trim().split(" ").length === 2
            )
          ).toBe(true);
          pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
          build.kill(signal);
          await build.exited;
          expect(build.signalCode).toBe(signal);
          for (const pid of pids) {
            expect(await waitFor(() => !isRunning(pid))).toBe(true);
          }
        } finally {
          build.kill("SIGKILL");
          for (const pid of pids) {
            if (isRunning(pid)) process.kill(pid, "SIGKILL");
          }
        }
      }, 20_000);
    }
  }
});
