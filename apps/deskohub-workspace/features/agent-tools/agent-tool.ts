import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { Effect, Option, Predicate, Schema, SchemaIssue } from "effect";
import { defaultLocale, type Locale, locales } from "@/features/i18n";
import {
  AgentToolError,
  type AgentToolUnavailableCode,
  agentToolErrorResultSchema,
} from "./agent-tool-error";

/**
 * Who may call a tool: anyone, or a customer who signed in through the
 * Workspace OAuth server.
 */
export type AgentToolAccess = "public" | "signed-in";

/** A schema that validates a value and describes it as JSON Schema. */
type AgentToolSchema<Input, Output = Input> = StandardSchemaV1<Input, Output> &
  StandardJSONSchemaV1<Input, Output>;

/** The structured result of a call; each tool's output schema owns its shape. */
const agentToolResultSchema = Schema.Record(Schema.String, Schema.Unknown);

type AgentToolResult = typeof agentToolResultSchema.Type;

/**
 * A capability customers' AI agents can call. Each protocol edge, such as the
 * MCP server, publishes the name, copy, and schemas, and runs `call` with the
 * raw arguments it received.
 */
export interface AgentTool<R> {
  /** Stable snake_case name agents call the tool by. */
  readonly name: string;
  readonly title: string;
  /** Static English guidance for the agent; never interpolates input. */
  readonly description: string;
  readonly access: AgentToolAccess;
  /**
   * Whether the tool only reads. A tool that creates a hold or any other
   * state is transactional.
   */
  readonly readOnly: boolean;
  /** The code an unexpected failure is reported with. */
  readonly unavailableCode: AgentToolUnavailableCode;
  readonly input: StandardJSONSchemaV1;
  /**
   * Every structured result the tool answers with: its success result, or
   * the error result of a failed call.
   */
  readonly output: AgentToolSchema<AgentToolResult>;
  /** Validates the arguments, parsed from the request JSON, and runs the tool. */
  readonly call: (
    args: Schema.Json
  ) => Effect.Effect<AgentToolResult, AgentToolError, R>;
}

/** Which tools a deployment publishes. */
export interface AgentToolExposure {
  readonly access: ReadonlyArray<AgentToolAccess>;
  /** Whether tools that create state are published, not only reads. */
  readonly transactional: boolean;
}

export const selectAgentTools = <R>(
  tools: ReadonlyArray<AgentTool<R>>,
  exposure: AgentToolExposure
) =>
  tools.filter(
    (tool) =>
      exposure.access.includes(tool.access) &&
      (exposure.transactional || tool.readOnly)
  );

/** The optional `locale` every tool accepts; messages default to English. */
export const agentToolLocaleField = Schema.optionalKey(
  Schema.Literals(locales).annotate({
    description:
      "Language of messages and product names in the result. Defaults to en-US.",
  })
);

export const getAgentToolLocale = (input: { readonly locale?: Locale }) =>
  input.locale ?? defaultLocale;

const agentToolLocaleInputSchema = Schema.Struct({
  locale: Schema.optionalKey(Schema.Literals(locales)),
});

/**
 * The locale raw tool arguments ask for, for messages about arguments that
 * failed validation as a whole.
 */
export const getRequestedAgentToolLocale = (args: Schema.Json): Locale =>
  Option.match(Schema.decodeUnknownOption(agentToolLocaleInputSchema)(args), {
    onNone: () => defaultLocale,
    onSome: getAgentToolLocale,
  });

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** The dotted path of the first invalid argument, such as `seats`. */
const getInvalidField = (issue: SchemaIssue.Issue) =>
  formatIssues(issue)
    .issues[0]?.path?.map((segment) =>
      String(Predicate.hasProperty(segment, "key") ? segment.key : segment)
    )
    .join(".") || undefined;

export const defineAgentTool = <
  Input extends Schema.Top & { readonly DecodingServices: never },
  Output extends Schema.Codec<AgentToolResult, AgentToolResult>,
  R,
>(definition: {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly access: AgentToolAccess;
  readonly readOnly: boolean;
  /** The code an unexpected failure is reported with. */
  readonly unavailableCode: AgentToolUnavailableCode;
  readonly input: Input;
  readonly output: Output;
  readonly run: (
    input: Input["Type"]
  ) => Effect.Effect<Output["Type"], AgentToolError, R>;
}): AgentTool<R> => {
  const decodeInput = Schema.decodeUnknownEffect(definition.input);

  return {
    name: definition.name,
    title: definition.title,
    description: definition.description,
    access: definition.access,
    readOnly: definition.readOnly,
    unavailableCode: definition.unavailableCode,
    input: Schema.toStandardJSONSchemaV1(definition.input),
    output: Schema.toStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(
        Schema.Union([definition.output, agentToolErrorResultSchema])
      )
    ),
    call: (args) =>
      decodeInput(args).pipe(
        Effect.mapError((error) =>
          AgentToolError.invalidInput(getInvalidField(error.issue))
        ),
        Effect.flatMap(definition.run),
        Effect.catchDefect((defect) =>
          Effect.fail(
            AgentToolError.unavailable(definition.unavailableCode)(defect)
          )
        )
      ),
  };
};
