import {
  decodeStandardSchema,
  parseStandardSchema,
} from "@deskohub/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Schema } from "effect";
import type { Locale } from "@/features/i18n";
import type { AgentEvalTaskId } from "./tasks";

/**
 * How a harness perceives the page. Recorded with every run so results can be
 * compared across perception modes, not only across products.
 */
const agentEvalPerceptions = [
  "accessibility-tree",
  "hybrid",
  "screenshot",
] as const;

export type AgentEvalPerception = (typeof agentEvalPerceptions)[number];

const agentEvalHarnessSchema = Schema.Struct({
  /** Stable slug used in test titles, result files, and the results table. */
  id: Schema.String.check(Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)),
  perception: Schema.Literals(agentEvalPerceptions),
  /**
   * Executable and arguments, spawned without a shell. Relative paths resolve
   * against the directory of the harness list file.
   */
  command: Schema.NonEmptyArray(Schema.NonEmptyString),
});

const agentEvalHarnessListSchema = Schema.toStandardSchemaV1(
  Schema.fromJsonString(Schema.NonEmptyArray(agentEvalHarnessSchema))
);

export type AgentEvalHarness = StandardSchemaV1.InferOutput<
  typeof agentEvalHarnessListSchema
>[number];

/**
 * Decodes the devbox-owned harness list. The list is local wiring (agent
 * runtimes, models, paths), so the repository holds only its shape.
 */
export const parseAgentEvalHarnesses = (
  serialized: string
): readonly AgentEvalHarness[] => {
  const harnesses = parseStandardSchema(
    agentEvalHarnessListSchema,
    serialized,
    "The agent eval harness list must be a JSON array of { id, perception, command } entries"
  );
  const ids = harnesses.map((harness) => harness.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Agent eval harness ids must be unique");
  }
  return harnesses;
};

/**
 * Written as JSON to the harness command's stdin. The browser is already
 * open on `startUrl`, signed in and past Deployment Protection; the harness
 * attaches to its default context through `cdpEndpoint`.
 */
export type AgentEvalRequest = {
  readonly version: 1;
  readonly taskId: AgentEvalTaskId;
  readonly locale: Locale;
  /** Natural-language task for the agent, in `locale`. */
  readonly prompt: string;
  readonly startUrl: string;
  /** Chrome DevTools Protocol HTTP endpoint, such as `http://127.0.0.1:9222`. */
  readonly cdpEndpoint: string;
  /** The agent's budget; the process is killed shortly after it. */
  readonly timeoutMs: number;
  /** A fresh directory the harness may write traces or screenshots into. */
  readonly outputDir: string;
};

const agentEvalResponseSchema = Schema.toStandardSchemaV1(
  Schema.fromJsonString(
    Schema.Struct({
      /** The agent's last message to the user. */
      finalAnswer: Schema.String,
      /** Browser actions the agent took (clicks, typing, navigation). */
      steps: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      /** Model cost in US dollars, when the harness can report it. */
      costUsd: Schema.optionalKey(
        Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
      ),
      /** Set when the agent or harness gave up or crashed. */
      error: Schema.optionalKey(Schema.String),
    })
  )
);

export type AgentEvalResponse = StandardSchemaV1.InferOutput<
  typeof agentEvalResponseSchema
>;

/**
 * Decodes the single JSON object a harness writes to stdout. Harness logs
 * belong on stderr; anything else on stdout makes the response invalid.
 */
export const parseAgentEvalResponse = (
  stdout: string
): AgentEvalResponse | undefined =>
  decodeStandardSchema(agentEvalResponseSchema, stdout.trim());
