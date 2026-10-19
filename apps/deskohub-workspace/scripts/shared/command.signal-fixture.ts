/**
 * Caller process for the command shutdown tests: starts one long command
 * and waits on it. The command's shell runs a foreground descendant, so a
 * group SIGINT reaches it (a non-interactive shell's background jobs ignore
 * SIGINT), and the descendant records the shell's pid and its own in the
 * file named by the first argument. The second argument selects whether the
 * command has a timeout (its own process group), none (the caller's), or no
 * timeout but its own process group.
 */
import { runCommand } from "./command";

const [pidFile, mode] = Bun.argv.slice(2);
if (
  pidFile === undefined ||
  (mode !== "timeout" && mode !== "no-timeout" && mode !== "own-group")
) {
  throw new Error(
    "usage: command.signal-fixture.ts <pid-file> <timeout|no-timeout|own-group>"
  );
}

await runCommand(
  ["bash", "-c", `sh -c 'echo "$PPID $$" > "$PID_FILE"; exec sleep 30' | cat`],
  {
    env: { PATH: process.env.PATH, PID_FILE: pidFile },
    ownProcessGroup: mode === "own-group",
    timeoutMs: mode === "timeout" ? 60_000 : undefined,
  }
);

// A group signal can end the command before the caller handles its own copy;
// stay alive so the caller only ever ends by the signal under test.
setInterval(() => undefined, 1_000);
