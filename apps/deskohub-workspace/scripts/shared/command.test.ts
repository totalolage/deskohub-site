import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commandOutput, runCommand } from "./command";

const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitUntilStopped = async (pid: number): Promise<boolean> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (!isRunning(pid)) return true;
    await Bun.sleep(20);
  }
  return false;
};

/** Settles a promise into its rejection, or `undefined` when it resolves. */
const rejectionOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (cause: unknown) => cause
  );

describe("runCommand", () => {
  test("captures stdout, stderr, stdin, and the exit code", async () => {
    const result = await runCommand(
      ["bash", "-c", 'read -r line; echo "out:$line"; echo err >&2; exit 3'],
      { stdin: "synthetic\n" }
    );

    expect(result).toEqual({
      exitCode: 3,
      signalCode: null,
      stdout: "out:synthetic\n",
      stderr: "err\n",
      timedOut: false,
    });
  });

  test("a timeout ends descendants that inherit the output pipes", async () => {
    const started = performance.now();
    const result = await runCommand(
      ["bash", "-c", "sleep 30 & echo $!; wait"],
      { timeoutMs: 200 }
    );
    const elapsed = performance.now() - started;

    expect(result.timedOut).toBe(true);
    expect(elapsed).toBeLessThan(5000);
    const descendant = Number(result.stdout.trim());
    expect(descendant).toBeGreaterThan(0);
    expect(await waitUntilStopped(descendant)).toBe(true);
  }, 15_000);

  test("a timeout still returns when a descendant outlives the process group", async () => {
    // setsid moves the descendant out of the command's process group, so the
    // group kill cannot reach it; the pipe drain must still be bounded.
    const started = performance.now();
    const result = await runCommand(
      ["bash", "-c", "setsid sleep 30 & echo $!; wait"],
      { timeoutMs: 200 }
    );
    const elapsed = performance.now() - started;
    const escaped = Number(result.stdout.trim());
    try {
      expect(result.timedOut).toBe(true);
      expect(elapsed).toBeLessThan(5000);
    } finally {
      if (escaped > 0 && isRunning(escaped)) process.kill(escaped, "SIGKILL");
    }
  }, 15_000);
});

describe("commandOutput", () => {
  test("returns stdout of a successful command", async () => {
    expect(await commandOutput(["bash", "-c", "echo ok"])).toBe("ok\n");
  });

  test("rejects a non-zero exit with its stderr", async () => {
    const failure = await rejectionOf(
      commandOutput(["bash", "-c", "echo broken >&2; exit 4"])
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("exited with 4");
    expect((failure as Error).message).toContain("broken");
  });

  test("rejects a timed-out command even when its direct child exited 0", async () => {
    const failure = await rejectionOf(
      commandOutput(["bash", "-c", "sleep 0.5 & exit 0"], { timeoutMs: 30 })
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("timed out");
  });

  test("rejects a command ended by a signal", async () => {
    const failure = await rejectionOf(
      commandOutput(["bash", "-c", "kill -TERM $$"])
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("SIGTERM");
  });
});

const readPids = async (pidFile: string): Promise<readonly number[]> => {
  for (let attempt = 0; attempt < 250; attempt++) {
    try {
      const pids = readFileSync(pidFile, "utf8").trim().split(" ").map(Number);
      if (pids.length === 2 && pids.every((pid) => pid > 0)) return pids;
    } catch {
      // The command has not written its pids yet.
    }
    await Bun.sleep(20);
  }
  throw new Error("The command never recorded its pids");
};

/**
 * `caller` signals only the caller's pid, as `kill <pid>` or a supervisor
 * does; `caller group` signals its whole process group, as a terminal's
 * Ctrl-C does. `ended` lists which recorded pids must be gone afterwards:
 * the command's shell and its descendant, or only the shell when
 * an untimed command shares the caller's group and only the caller was
 * signalled.
 */
const shutdownScenarios = [
  { mode: "timeout", target: "caller", ended: [0, 1] },
  { mode: "no-timeout", target: "caller", ended: [0] },
  { mode: "no-timeout", target: "caller group", ended: [0, 1] },
] as const;

describe("caller shutdown", () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const { mode, target, ended } of shutdownScenarios) {
      test(`${signal} to the ${target} ends its ${mode} command and keeps the signal exit`, async () => {
        const directory = mkdtempSync(join(tmpdir(), "command-shutdown-"));
        const pidFile = join(directory, "pids");
        const caller = Bun.spawn({
          cmd: [
            process.execPath,
            join(import.meta.dir, "command.signal-fixture.ts"),
            pidFile,
            mode,
          ],
          detached: target === "caller group",
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });
        let pids: readonly number[] = [];
        try {
          pids = await readPids(pidFile);
          process.kill(target === "caller" ? caller.pid : -caller.pid, signal);
          await caller.exited;

          // The caller still dies by the signal itself.
          expect(caller.signalCode).toBe(signal);
          for (const index of ended) {
            expect(await waitUntilStopped(pids[index] ?? 0)).toBe(true);
          }
        } finally {
          caller.kill("SIGKILL");
          for (const pid of pids) {
            if (isRunning(pid)) process.kill(pid, "SIGKILL");
          }
          rmSync(directory, { recursive: true, force: true });
        }
      }, 20_000);
    }
  }

  for (const kind of [
    "once-before",
    "once-after",
    "prepend-once-after",
    "prepend-self-removing-after",
  ] as const) {
    test(`a caller's own one-shot SIGTERM listener (${kind}) handles the signal`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "command-listener-"));
      const handledFile = join(directory, "handled");
      const caller = Bun.spawn({
        cmd: [
          process.execPath,
          join(import.meta.dir, "command.listener-fixture.ts"),
          handledFile,
          kind,
        ],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      try {
        const reader = caller.stdout.getReader();
        const { value } = await reader.read();
        expect(new TextDecoder().decode(value)).toContain("ready");
        reader.releaseLock();

        process.kill(caller.pid, "SIGTERM");
        for (let attempt = 0; attempt < 50; attempt += 1) {
          if (existsSync(handledFile)) break;
          await Bun.sleep(20);
        }
        await Bun.sleep(200);

        expect(existsSync(handledFile)).toBe(true);
        // The caller's own listener handled SIGTERM, so it must not have
        // been ended by a re-raised signal.
        expect(caller.exitCode).toBeNull();
        expect(caller.signalCode).toBeNull();
      } finally {
        caller.kill("SIGKILL");
        rmSync(directory, { recursive: true, force: true });
      }
    }, 20_000);
  }

  test("installs one set of shutdown listeners however many commands run", async () => {
    const before = [
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
      process.listenerCount("exit"),
    ];
    await runCommand(["bash", "-c", "exit 0"], { timeoutMs: 5000 });
    const installed = [
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
      process.listenerCount("exit"),
    ];
    for (const [index, count] of installed.entries()) {
      expect(count - (before[index] ?? 0)).toBeLessThanOrEqual(1);
    }
    await Promise.all([
      runCommand(["bash", "-c", "sleep 0.1"], { timeoutMs: 5000 }),
      runCommand(["bash", "-c", "sleep 0.1"]),
    ]);
    expect([
      process.listenerCount("SIGINT"),
      process.listenerCount("SIGTERM"),
      process.listenerCount("exit"),
    ]).toEqual(installed);
  });
});
