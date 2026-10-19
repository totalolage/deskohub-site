/**
 * Runs an external command to completion and captures its output, in Bun and
 * in Node (such as Playwright's worker processes) alike.
 *
 * Commands always run asynchronously. Bun 1.4.2's synchronous spawn
 * (`Bun.spawnSync` and the `node:child_process` `*Sync` functions) waits on
 * a process-wide isolated event loop whose poll count drifts when a garbage
 * collection inside the call finalizes an earlier object's poll, such as a
 * stdio writer from a test file that `bun test --parallel` already
 * discarded. Once it drifts, later synchronous spawns in the same process
 * never observe their child's exit and spin until the test times out
 * (oven-sh/bun#43697, fixed upstream by oven-sh/bun#44581 after 1.4.2).
 *
 * Bun spawns through `Bun.spawn`: under Bun, a caller that spawned a
 * detached `node:child_process` command often dies by SIGINT or SIGTERM
 * without running its listeners, so the command would outlive it.
 */

import { spawn as spawnNodeProcess } from "node:child_process";
import type { Readable } from "node:stream";

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
  /**
   * Sends SIGTERM to the process group at the timeout and SIGKILL this much
   * later, so the command can stop its own descendants first. A command that
   * exits sooner gets the group's SIGKILL as soon as its output settles.
   */
  readonly terminateGraceMs?: number;
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

/** One spawned command, the same shape under Bun and Node. */
type SpawnedCommand = {
  readonly pid: number;
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr: ReadableStream<Uint8Array>;
  readonly exited: Promise<{
    readonly exitCode: number | null;
    readonly signalCode: string | null;
  }>;
  readonly kill: (signal: NodeJS.Signals) => void;
};

type SpawnRequest = {
  readonly command: readonly string[];
  readonly cwd: string | undefined;
  readonly detached: boolean;
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
  readonly stdin: string | undefined;
};

const spawnWithBun = (request: SpawnRequest): SpawnedCommand => {
  const child = Bun.spawn({
    cmd: [...request.command],
    cwd: request.cwd,
    env: request.env,
    stdin: request.stdin === undefined ? "ignore" : new Blob([request.stdin]),
    stdout: "pipe",
    stderr: "pipe",
    detached: request.detached,
  });
  return {
    exited: child.exited.then(() => ({
      exitCode: child.exitCode,
      signalCode: child.signalCode,
    })),
    kill: (signal) => child.kill(signal),
    pid: child.pid,
    stderr: child.stderr,
    stdout: child.stdout,
  };
};

const spawnWithNode = async (
  request: SpawnRequest
): Promise<SpawnedCommand> => {
  const [executable = "", ...args] = request.command;
  const child = spawnNodeProcess(executable, args, {
    cwd: request.cwd,
    detached: request.detached,
    // Next's global types require NODE_ENV on ProcessEnv. As with Bun.spawn,
    // the child gets exactly the caller's environment.
    env: request.env as NodeJS.ProcessEnv | undefined,
    // stdin is always a pipe, ended at once when there is no input, so the
    // spawn overload types every stream as present.
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = new Promise<{
    readonly exitCode: number | null;
    readonly signalCode: string | null;
  }>((resolve) => {
    child.once("exit", (exitCode, signalCode) =>
      resolve({ exitCode, signalCode })
    );
  });
  // Bun.spawn throws for a command that cannot start; match it.
  await new Promise<void>((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  // A command may exit without reading its stdin; the broken pipe is not
  // the caller's failure, and the exit code reports the command's own.
  child.stdin.on("error", () => undefined);
  child.stdin.end(request.stdin);
  // `Readable.toWeb` returns Node's own stream type, which TypeScript
  // doesn't relate to the global one Bun's spawn returns.
  const toWeb = (stream: Readable): ReadableStream<Uint8Array> => {
    const chunks: AsyncIterator<Uint8Array> = stream[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
      cancel: async () => {
        await chunks.return?.();
      },
      pull: async (controller) => {
        const { done, value } = await chunks.next();
        if (done) controller.close();
        else controller.enqueue(value);
      },
    });
  };
  return {
    exited,
    kill: (signal) => child.kill(signal),
    pid: child.pid ?? 0,
    stderr: toWeb(child.stderr),
    stdout: toWeb(child.stdout),
  };
};

// Bun spawns synchronously, so its shutdown tracking starts at once.
const spawnCommand = (
  request: SpawnRequest
): SpawnedCommand | Promise<SpawnedCommand> =>
  process.versions.bun === undefined
    ? spawnWithNode(request)
    : spawnWithBun(request);

/** Signals a command's process group, or just the command when it leads none. */
const signalCommand = (
  child: SpawnedCommand,
  ownsGroup: boolean,
  signal: NodeJS.Signals
): void => {
  if (ownsGroup) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group is already gone; fall through for the direct child.
    }
  }
  child.kill(signal);
};

const killCommand = (child: SpawnedCommand, ownsGroup: boolean): void =>
  signalCommand(child, ownsGroup, "SIGKILL");

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
  const spawned = spawnCommand({
    command,
    cwd: options.cwd,
    detached: ownsGroup,
    env: options.env,
    stdin: options.stdin,
  });
  const child = spawned instanceof Promise ? await spawned : spawned;
  const untrack = trackCommand(() => killCommand(child, ownsGroup));
  const abandonOutput = Promise.withResolvers<void>();
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let killed = false;
  const kill = () => {
    killed = true;
    killCommand(child, ownsGroup);
    drainTimer = setTimeout(abandonOutput.resolve, timedOutDrainMs);
  };
  const timer =
    options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          if (options.terminateGraceMs === undefined) {
            kill();
            return;
          }
          signalCommand(child, ownsGroup, "SIGTERM");
          killTimer = setTimeout(kill, options.terminateGraceMs);
        }, options.timeoutMs);
  try {
    const [stdout, stderr, { exitCode, signalCode }] = await Promise.all([
      readText(child.stdout, abandonOutput.promise),
      readText(child.stderr, abandonOutput.promise),
      child.exited,
    ]);
    return { exitCode, signalCode, stdout, stderr, timedOut };
  } finally {
    // A command that exited during the grace can leave descendants that
    // ignored SIGTERM and hold no output pipe; nothing would end them later.
    if (timedOut && !killed) killCommand(child, ownsGroup);
    clearTimeout(timer);
    clearTimeout(killTimer);
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
