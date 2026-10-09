import { describe, expect, test } from "bun:test";
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
