import { isAbsolute, resolve } from "node:path";
import { NodeServices } from "@effect/platform-node";
import { Effect, Stream } from "effect";
import { ChildProcess } from "effect/unstable/process";
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
const forceKillAfter = "10 seconds";

const decodeOutput = (stream: Stream.Stream<Uint8Array, unknown>) =>
  stream.pipe(Stream.decodeText(), Stream.mkString);

const resolveExecutable = (executable: string, directory: string) =>
  executable.includes("/") && !isAbsolute(executable)
    ? resolve(directory, executable)
    : executable;

const toOutcome = (
  exitCode: number,
  response: AgentEvalResponse | undefined
): AgentEvalHarnessOutcomeKind => {
  if (response?.error !== undefined) return "agent-error";
  if (exitCode !== 0) return "exit";
  return response ? "completed" : "invalid-response";
};

/**
 * Spawns one harness command without a shell, writes the request to its
 * stdin, and reads its JSON response from stdout. The process is terminated
 * once `killAfterMs` passes. Never fails: every ending is an outcome the run
 * records.
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
  return Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* ChildProcess.make(
        resolveExecutable(executable, harnessDirectory),
        args,
        {
          cwd: harnessDirectory,
          extendEnv: true,
          forceKillAfter,
          stdin: Stream.make(
            new TextEncoder().encode(`${JSON.stringify(request)}\n`)
          ),
        }
      );
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          decodeOutput(handle.stdout),
          decodeOutput(handle.stderr),
          handle.exitCode,
        ],
        { concurrency: "unbounded" }
      );
      const response = parseAgentEvalResponse(stdout);
      return {
        exitCode,
        outcome: toOutcome(exitCode, response),
        response,
        stderr: stderr.slice(-stderrTailCharacters),
      } satisfies AgentEvalHarnessRun;
    })
  ).pipe(
    Effect.timeoutOrElse({
      duration: `${killAfterMs} millis`,
      orElse: () =>
        Effect.succeed<AgentEvalHarnessRun>({
          exitCode: null,
          outcome: "timeout",
          response: undefined,
          stderr: "",
        }),
    }),
    Effect.catch((cause) =>
      Effect.succeed<AgentEvalHarnessRun>({
        exitCode: null,
        outcome: "spawn-failure",
        response: undefined,
        stderr: String(cause).slice(-stderrTailCharacters),
      })
    ),
    Effect.provide(NodeServices.layer)
  );
};
