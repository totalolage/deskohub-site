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

/** Kills a command's process group, or just the command when it leads none. */
const killCommand = (child: Bun.Subprocess, ownsGroup: boolean): void => {
  if (ownsGroup) {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // The group is already gone; fall through for the direct child.
    }
  }
  child.kill("SIGKILL");
};

/**
 * Kill functions of the commands still running. Caller shutdown (SIGINT,
 * SIGTERM, exit) ends them, because a command that leads its own process
 * group would otherwise outlive the caller.
 *
 * The shutdown handlers are installed with the first command and kept until a
 * signal arrives: Bun intercepts a signal while a listener exists and
 * delivers it to JavaScript later, so removing the listener when the last
 * command finishes could swallow a signal that arrived just before. With no
 * command running, the handler kills nothing and re-raises the signal, which
 * matches the default action.
 */
const activeCommands = new Set<() => void>();
const shutdownSignals = ["SIGINT", "SIGTERM"] as const;

const killActiveCommands = (): void => {
  for (const kill of activeCommands) kill();
  activeCommands.clear();
};

const removeShutdownHandlers = (): void => {
  for (const [signal, handler] of signalHandlers) process.off(signal, handler);
  process.off("exit", killActiveCommands);
  process.off("newListener", keepShutdownHandlersFirst);
  shutdownHandlersInstalled = false;
};

const endCommandsOnSignal = (signal: NodeJS.Signals): void => {
  killActiveCommands();
  removeShutdownHandlers();
  // Listening disabled the signal's default action. When no other listener
  // handles it, raise it again so the caller ends with the same status.
  if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
};

const signalHandlers = new Map(
  shutdownSignals.map((signal) => [signal, () => endCommandsOnSignal(signal)])
);

let shutdownHandlersInstalled = false;

const moveShutdownHandlersFirst = (): void => {
  if (!shutdownHandlersInstalled) return;
  for (const [signal, handler] of signalHandlers) {
    if (process.listeners(signal)[0] === handler) continue;
    process.off(signal, handler);
    process.prependListener(signal, handler);
  }
};

/**
 * The re-raise check counts the listeners that take part in a delivery, so
 * the handler must run before every caller listener, including one-shot
 * listeners a caller prepends later. `newListener` fires before the listener
 * is added, so the handlers move back to the front once it is in place.
 */
const keepShutdownHandlersFirst = (event: string | symbol): void => {
  if (shutdownSignals.some((signal) => signal === event)) {
    queueMicrotask(moveShutdownHandlersFirst);
  }
};

const trackCommand = (kill: () => void): (() => void) => {
  if (!shutdownHandlersInstalled) {
    // Run before the caller's own listeners: a caller's one-shot listener
    // removes itself when it runs, and the re-raise check must still see it.
    for (const [signal, handler] of signalHandlers) {
      process.prependListener(signal, handler);
    }
    process.on("exit", killActiveCommands);
    process.on("newListener", keepShutdownHandlersFirst);
    shutdownHandlersInstalled = true;
  }
  activeCommands.add(kill);
  return () => {
    activeCommands.delete(kill);
  };
};

export const runCommand = async (
  command: readonly string[],
  options: CommandOptions = {}
): Promise<CommandResult> => {
  // A timed command leads its own process group so the timeout reaches the
  // descendants that inherited its output pipes. An untimed one stays in the
  // caller's group, where terminal and supervisor signals still reach it.
  const ownsGroup = options.timeoutMs !== undefined;
  const child = Bun.spawn({
    cmd: [...command],
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin === undefined ? "ignore" : new Blob([options.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    detached: ownsGroup,
  });
  const untrack = trackCommand(() => killCommand(child, ownsGroup));
  const abandonOutput = Promise.withResolvers<void>();
  let timedOut = false;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          killCommand(child, ownsGroup);
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
    untrack();
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
