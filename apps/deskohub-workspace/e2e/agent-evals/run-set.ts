import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseStandardSchema } from "@deskohub/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import { workspaceDir, writeJsonAtomically } from "../runtime";
import type {
  AgentEvalReservationRecord,
  AgentEvalStatusPageCheck,
} from "./judges";
import {
  type AgentEvalRunResult,
  type AgentEvalSummary,
  formatAgentEvalSummaryMarkdown,
} from "./results";
import type { AgentEvalTaskParameters } from "./tasks";

/**
 * Playwright clears the config's output directory on every invocation, so
 * results live beside it: one directory per run set (one invocation), kept
 * until someone deletes it.
 */
const agentEvalResultsRoot = resolve(
  workspaceDir,
  "e2e-artifacts",
  "agent-eval-results"
);

/** The agent eval config's Playwright output directory. */
export const agentEvalOutputDirectory = resolve(
  workspaceDir,
  "e2e-artifacts",
  "agent-evals"
);

const runSetPath = resolve(agentEvalOutputDirectory, "run-set.json");

const runSetSchema = Schema.toStandardSchemaV1(
  Schema.fromJsonString(
    Schema.Struct({
      runSetId: Schema.String.check(Schema.isPattern(/^[0-9a-z-]+$/)),
      startedAt: Schema.String,
      /** The preview the setup verified before any run seeded data. */
      target: Schema.Struct({
        deploymentId: Schema.NonEmptyString,
        sha: Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/)),
        verifiedAt: Schema.String,
      }),
    })
  )
);

export type AgentEvalRunSet = StandardSchemaV1.InferOutput<typeof runSetSchema>;

const agentEvalRunSetDirectory = (runSetId: string) =>
  resolve(agentEvalResultsRoot, runSetId);

/** Account identity journals of the run set's synthetic accounts. */
export const agentEvalJournalDirectory = (runSetId: string) =>
  resolve(agentEvalRunSetDirectory(runSetId), "journals");

const runResultsDirectory = (runSetId: string) =>
  resolve(agentEvalRunSetDirectory(runSetId), "runs");

/** A sortable, readable run set id such as `20261018-142501-3f9a`. */
export const makeAgentEvalRunSetId = (now = new Date()) =>
  `${now
    .toISOString()
    .slice(0, 19)
    .replace(/[-:]/g, "")
    .replace("T", "-")}-${crypto.randomUUID().slice(0, 4)}`;

/**
 * Opens the invocation's run set, and keeps a copy beside its results so the
 * verified target outlives Playwright's output directory.
 */
export const writeAgentEvalRunSet = async (runSet: AgentEvalRunSet) => {
  await writeJsonAtomically(runSetPath, runSet);
  await writeJsonAtomically(
    resolve(agentEvalRunSetDirectory(runSet.runSetId), "run-set.json"),
    runSet
  );
};

export const readAgentEvalRunSet = async (): Promise<AgentEvalRunSet> =>
  parseStandardSchema(
    runSetSchema,
    await readFile(runSetPath, "utf8"),
    "The agent eval run set is invalid"
  );

const runResultFileName = (result: AgentEvalRunResult) =>
  `${result.taskId}.${result.locale}.${result.harnessId}.${result.repeat}.json`;

export const writeAgentEvalRunResult = async (result: AgentEvalRunResult) => {
  await writeJsonAtomically(
    resolve(runResultsDirectory(result.runSetId), runResultFileName(result)),
    result
  );
};

/**
 * What the judge read for one run, kept beside the run result so the run can
 * be judged again after the judges change: the facts task's redacted final
 * answer, or a booking task's reservation records and status page check.
 * Reservations are deleted or cancelled at cleanup, so this is the only copy.
 */
export type AgentEvalJudgeInput =
  | {
      readonly parameters: Extract<
        AgentEvalTaskParameters,
        { taskId: "facts" }
      >;
      readonly finalAnswer: string;
    }
  | {
      readonly parameters: Exclude<
        AgentEvalTaskParameters,
        { taskId: "facts" }
      >;
      readonly records: readonly AgentEvalReservationRecord[];
      readonly statusPage: AgentEvalStatusPageCheck | null;
    };

/** Writes a judge input; the caller redacts it first. */
export const writeAgentEvalJudgeInput = async (
  result: AgentEvalRunResult,
  judgeInput: AgentEvalJudgeInput
) => {
  await writeJsonAtomically(
    resolve(
      agentEvalRunSetDirectory(result.runSetId),
      "judge-inputs",
      runResultFileName(result)
    ),
    judgeInput
  );
};

const readDirectoryEntries = async (directory: string) => {
  try {
    return await readdir(directory);
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") {
      return [];
    }
    throw cause;
  }
};

/** Every run result the run set wrote so far. */
export const readAgentEvalRunResults = async (
  runSetId: string
): Promise<readonly AgentEvalRunResult[]> => {
  const directory = runResultsDirectory(runSetId);
  const files = (await readDirectoryEntries(directory)).filter((file) =>
    file.endsWith(".json")
  );
  return Promise.all(
    files.map(
      async (file) =>
        JSON.parse(
          await readFile(resolve(directory, file), "utf8")
        ) as AgentEvalRunResult
    )
  );
};

/** Owner ids of the run set's account identity journals. */
export const listAgentEvalJournalOwners = async (runSetId: string) =>
  (await readDirectoryEntries(agentEvalJournalDirectory(runSetId)))
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length));

/** Writes `summary.json` and `summary.md`; returns the Markdown path. */
export const writeAgentEvalSummary = async (summary: AgentEvalSummary) => {
  const directory = agentEvalRunSetDirectory(summary.runSetId);
  await writeJsonAtomically(resolve(directory, "summary.json"), summary);
  const markdownPath = resolve(directory, "summary.md");
  await writeFile(markdownPath, formatAgentEvalSummaryMarkdown(summary), {
    encoding: "utf8",
    mode: 0o600,
  });
  return markdownPath;
};
