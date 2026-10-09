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
  /**
   * Kills the command's process group with SIGKILL once it runs longer than
   * this, and stops waiting for output shortly after.
   */
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

/** How long output may keep draining after a timeout kill before it is abandoned. */
const timedOutDrainMs = 500;

const readText = async (
  stream: ReadableStream<Uint8Array>,
  abandoned: Promise<void>
): Promise<string> => {
  const reader = stream.getReader();
  // Cancelling settles a pending read as done, so a pipe still held open by
  // an escaped descendant cannot keep the caller waiting.
  void abandoned.then(() => reader.cancel());
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
  }
};

/** Kills the command's whole process group, then the direct child if it led none. */
const killCommand = (child: Bun.Subprocess): void => {
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
};

export const runCommand = async (
  command: readonly string[],
  options: CommandOptions = {}
): Promise<CommandResult> => {
  // `detached` makes the command lead its own process group, so a timeout
  // reaches the descendants that inherited its output pipes.
  const child = Bun.spawn({
    cmd: [...command],
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    detached: true,
  });
  const abandonOutput = Promise.withResolvers<void>();
  let timedOut = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          killCommand(child);
          drainTimer = setTimeout(abandonOutput.resolve, timedOutDrainMs);
        }, options.timeoutMs);
  try {
    const [stdout, stderr] = await Promise.all([
      readText(child.stdout, abandonOutput.promise),
      readText(child.stderr, abandonOutput.promise),
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
    clearTimeout(drainTimer);
  }
};

const describeTermination = (result: CommandResult): string | undefined => {
  if (result.timedOut) return "timed out";
  if (result.signalCode !== null) return `was ended by ${result.signalCode}`;
  if (result.exitCode !== 0) return `exited with ${result.exitCode}`;
  return undefined;
};

/**
 * Runs a command that must succeed and returns its stdout. A non-zero exit,
 * a signal, or a timeout rejects, even when the direct child exited 0.
 */
export const commandOutput = async (
  command: readonly string[],
  options: CommandOptions = {}
): Promise<string> => {
  const result = await runCommand(command, options);
  const failure = describeTermination(result);
  if (failure !== undefined) {
    throw new Error(
      `Command \`${command.join(" ")}\` ${failure}${result.stderr ? `:\n${result.stderr}` : ""}`
    );
  }
  return result.stdout;
};
