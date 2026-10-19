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
import { nextBuildRuns } from "./next-build";

describe("nextBuildRuns", () => {
  test("compiles and generates in separate runs by default", () => {
    expect(nextBuildRuns([])).toEqual([
      ["--experimental-build-mode=compile"],
      ["--experimental-build-mode=generate"],
    ]);
  });

  test("passes other arguments to both runs", () => {
    expect(nextBuildRuns(["--debug"])).toEqual([
      ["--experimental-build-mode=compile", "--debug"],
      ["--experimental-build-mode=generate", "--debug"],
    ]);
  });

  test("runs an explicit build mode once as given", () => {
    expect(nextBuildRuns(["--experimental-build-mode=compile"])).toEqual([
      ["--experimental-build-mode=compile"],
    ]);
    expect(nextBuildRuns(["--experimental-build-mode", "generate"])).toEqual([
      ["--experimental-build-mode", "generate"],
    ]);
  });
});

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitFor = async (condition: () => boolean): Promise<boolean> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return true;
    await Bun.sleep(20);
  }
  return false;
};

/**
 * A stand-in `next` on PATH: it records each invocation's arguments, exits
 * with `NEXT_FAIL_EXIT` in the `NEXT_FAIL_MODE` build mode, and in
 * `NEXT_HANG_MODE` records its pid and waits for a signal.
 */
const fakeNext = `#!/usr/bin/env bash
echo "$*" >> "$NEXT_CALLS"
case "$*" in *"build-mode=\${NEXT_FAIL_MODE:-none}"*) exit "$NEXT_FAIL_EXIT" ;; esac
case "$*" in *"build-mode=\${NEXT_HANG_MODE:-none}"*) echo $$ > "$NEXT_PID"; exec sleep 30 ;; esac
`;

const startBuild = (
  directory: string,
  env: Readonly<Record<string, string>> = {}
) => {
  const bin = join(directory, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "next"), fakeNext, { mode: 0o755 });
  return Bun.spawn({
    cmd: [process.execPath, join(import.meta.dir, "next-build.ts")],
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

describe("next-build", () => {
  let directory = "";
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "next-build-"));
  });
  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("compiles, then generates", async () => {
    const build = startBuild(directory);
    expect(await build.exited).toBe(0);
    expect(calls(directory)).toEqual([
      "build --turbo --experimental-build-mode=compile",
      "build --turbo --experimental-build-mode=generate",
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
    expect(calls(directory)).toEqual([
      "build --turbo --experimental-build-mode=compile",
    ]);
  });

  test("a failed generate fails the build", async () => {
    const build = startBuild(directory, {
      NEXT_FAIL_EXIT: "4",
      NEXT_FAIL_MODE: "generate",
    });
    expect(await build.exited).toBe(4);
    expect(calls(directory)).toHaveLength(2);
  });

  test("a phase ended by a signal exits with its shell status", async () => {
    const build = startBuild(directory, { NEXT_HANG_MODE: "generate" });
    const pidFile = join(directory, "pid");
    try {
      expect(await waitFor(() => existsSync(pidFile))).toBe(true);
      process.kill(Number(readFileSync(pidFile, "utf8")), "SIGKILL");
      expect(await build.exited).toBe(137);
    } finally {
      build.kill("SIGKILL");
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const mode of ["compile", "generate"] as const) {
      test(`${signal} to the runner ends its ${mode} phase`, async () => {
        const build = startBuild(directory, { NEXT_HANG_MODE: mode });
        const pidFile = join(directory, "pid");
        let nextPid = 0;
        try {
          expect(await waitFor(() => existsSync(pidFile))).toBe(true);
          nextPid = Number(readFileSync(pidFile, "utf8"));
          build.kill(signal);
          await build.exited;
          expect(build.signalCode).toBe(signal);
          expect(await waitFor(() => !isRunning(nextPid))).toBe(true);
        } finally {
          build.kill("SIGKILL");
          if (nextPid !== 0 && isRunning(nextPid)) {
            process.kill(nextPid, "SIGKILL");
          }
        }
      }, 20_000);
    }
  }
});
