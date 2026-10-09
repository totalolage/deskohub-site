/**
 * Runs an external command to completion and captures its output.
 *
 * Commands always run asynchronously. Bun 1.4.2's synchronous spawn
 * (`Bun.spawnSync` and the `node:child_process` `*Sync` functions) waits on
 * a process-wide isolated event loop whose poll count drifts when a garbage
 * collection inside the call finalizes an earlier object's poll, such as a
 * stdio writer from a test file that `bun test --parallel` already
 * discarded. Once it drifts, later synchronous spawns in the same process
 * never observe their child's exit and spin until the test times out
 * (oven-sh/bun#43697, fixed upstream by oven-sh/bun#44581 after 1.4.2).
 */

export interface CommandOptions {
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Text written to the command's stdin; stdin is closed when omitted. */
  readonly stdin?: string;
  /** Kills the command with SIGKILL once it runs longer than this. */
  readonly timeoutMs?: number;
}

export interface CommandResult {
  /** `null` when the command was ended by a signal. */
  readonly exitCode: number | null;
  readonly signalCode: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export const runCommand = async (
  command: readonly string[],
  options: CommandOptions = {}
): Promise<CommandResult> => {
  const child = Bun.spawn({
    cmd: [...command],
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, options.timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return {
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      stdout,
      stderr,
      timedOut,
    };
  } finally {
    clearTimeout(timer);
  }
};

const describeTermination = (result: CommandResult): string => {
  if (result.timedOut) return "timed out";
  if (result.signalCode !== null) return `was ended by ${result.signalCode}`;
  return `exited with ${result.exitCode}`;
};

/** Runs a command that must succeed and returns its stdout. */
export const commandOutput = async (
  command: readonly string[],
  options: CommandOptions = {}
): Promise<string> => {
  const result = await runCommand(command, options);
  if (result.exitCode !== 0) {
    const termination = describeTermination(result);
    throw new Error(
      `Command \`${command.join(" ")}\` ${termination}${result.stderr ? `:\n${result.stderr}` : ""}`
    );
  }
  return result.stdout;
};
