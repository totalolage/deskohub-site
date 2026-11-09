import { isAbsolute, resolve } from "node:path";
import { Effect } from "effect";
import { runCommand } from "../../scripts/shared/command";
import { workspaceAgentEvalTimeouts } from "../timeouts";
import {
  type AgentEvalHarness,
  type AgentEvalRequest,
  type AgentEvalResponse,
  parseAgentEvalResponse,
} from "./harness-contract";
import type { AgentEvalHarnessOutcomeKind } from "./judges";

/** How one harness process ended, with its response when it gave a valid one. */
export type AgentEvalHarnessRun = {
  readonly outcome: AgentEvalHarnessOutcomeKind;
  readonly response: AgentEvalResponse | undefined;
  readonly exitCode: number | null;
  /** The tail of the harness's stderr, for the run's local log file. */
  readonly stderr: string;
};

const stderrTailCharacters = 16_000;

const resolveExecutable = (executable: string, directory: string) =>
  executable.includes("/") && !isAbsolute(executable)
    ? resolve(directory, executable)
    : executable;

const toOutcome = ({
  exitCode,
  response,
  timedOut,
}: {
  readonly exitCode: number | null;
  readonly response: AgentEvalResponse | undefined;
  readonly timedOut: boolean;
}): AgentEvalHarnessOutcomeKind => {
  if (timedOut) return "timeout";
  if (response?.error !== undefined) return "agent-error";
  if (exitCode !== 0) return "exit";
  return response ? "completed" : "invalid-response";
};

/**
 * Spawns one harness command without a shell, writes the request to its
 * stdin, and reads its JSON response from stdout. Once `killAfterMs` passes,
 * the harness's process group gets SIGTERM and, after the exit grace or as
 * soon as the harness exits, SIGKILL. Never fails: every ending is an outcome
 * the run records.
 */
export const runAgentEvalHarness = ({
  harness,
  harnessDirectory,
  killAfterMs,
  request,
}: {
  readonly harness: AgentEvalHarness;
  /** Relative executables and the working directory resolve against it. */
  readonly harnessDirectory: string;
  readonly killAfterMs: number;
  readonly request: AgentEvalRequest;
}): Effect.Effect<AgentEvalHarnessRun> => {
  const [executable, ...args] = harness.command;
  return Effect.tryPromise(() =>
    runCommand([resolveExecutable(executable, harnessDirectory), ...args], {
      cwd: harnessDirectory,
      stdin: `${JSON.stringify(request)}\n`,
      terminateGraceMs: workspaceAgentEvalTimeouts.harnessKillGrace,
      timeoutMs: killAfterMs,
    })
  ).pipe(
    Effect.map((result) => {
      const response = result.timedOut
        ? undefined
        : parseAgentEvalResponse(result.stdout);
      return {
        exitCode: result.exitCode,
        outcome: toOutcome({
          exitCode: result.exitCode,
          response,
          timedOut: result.timedOut,
        }),
        response,
        stderr: result.stderr.slice(-stderrTailCharacters),
      } satisfies AgentEvalHarnessRun;
    }),
    Effect.catch((cause) =>
      Effect.succeed<AgentEvalHarnessRun>({
        exitCode: null,
        outcome: "spawn-failure",
        response: undefined,
        stderr: String(cause.cause ?? cause).slice(-stderrTailCharacters),
      })
    )
  );
};
