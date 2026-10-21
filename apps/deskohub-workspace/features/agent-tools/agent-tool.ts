import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import { Effect, Layer, Option, Predicate, Schema, SchemaIssue } from "effect";
import type { CustomerAgentScope } from "@/features/account";
import { defaultLocale, type Locale, locales } from "@/features/i18n";
import type { AgentToolAccountBudget } from "./agent-tool-call-budget";
import {
  AgentToolError,
  type AgentToolUnavailableCode,
  agentToolErrorResultSchema,
} from "./agent-tool-error";
import {
  type CustomerAgentCaller,
  customerAgentCallServices,
  type SignedInAgentToolRequirements,
  type SignedInAgentToolServices,
} from "./customer-agent-caller";

/**
 * Who may call a tool: anyone, or a customer who signed in through the
 * Workspace OAuth server.
 */
type AgentToolAccess = "public" | "signed-in";

/**
 * Who may call a tool. A signed-in tool also names the OAuth scope the
 * customer must have granted the agent; public tools need no token.
 */
export type AgentToolAuthorization =
  | { readonly access: "public" }
  | {
      readonly access: "signed-in";
      readonly scope: CustomerAgentScope;
      readonly accountBudget?: AgentToolAccountBudget;
    };

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
export type AgentTool<R> = AgentToolAuthorization & {
  /** Stable snake_case name agents call the tool by. */
  readonly name: string;
  readonly title: string;
  /** Static English guidance for the agent; never interpolates input. */
  readonly description: string;
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
  /**
   * Validates the arguments, parsed from the request JSON, and runs the tool
   * for the agent whose token the request carried, if any.
   */
  readonly call: (
    args: Schema.Json,
    caller?: Option.Option<CustomerAgentCaller>
  ) => Effect.Effect<AgentToolResult, AgentToolError, R>;
};

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

type AgentToolDefinition<
  Input extends Schema.Top & { readonly DecodingServices: never },
  Output extends Schema.Codec<AgentToolResult, AgentToolResult>,
  R,
> = {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly readOnly: boolean;
  /** The code an unexpected failure is reported with. */
  readonly unavailableCode: AgentToolUnavailableCode;
  readonly input: Input;
  readonly output: Output;
  readonly run: (
    input: Input["Type"]
  ) => Effect.Effect<Output["Type"], AgentToolError, R>;
};

/** A tool anyone may call, without an access token. */
export const defineAgentTool = <
  Input extends Schema.Top & { readonly DecodingServices: never },
  Output extends Schema.Codec<AgentToolResult, AgentToolResult>,
  R,
>(
  definition: AgentToolDefinition<Input, Output, R> & {
    readonly access: "public";
  }
): AgentTool<R> =>
  makeAgentTool({ access: "public" }, definition, (run) => run);

/**
 * A tool only an agent the customer signed in through may call. The MCP
 * route refuses a call without a token granting `scope` before it runs; the
 * tool reads the customer through its `CurrentCustomerAgentGrant` and
 * the account services backed by the caller's token.
 */
export const defineSignedInAgentTool = <
  Input extends Schema.Top & { readonly DecodingServices: never },
  Output extends Schema.Codec<AgentToolResult, AgentToolResult>,
  R,
>(
  definition: AgentToolDefinition<Input, Output, R> & {
    readonly scope: CustomerAgentScope;
    readonly accountBudget?: AgentToolAccountBudget;
  }
): AgentTool<
  Exclude<R, SignedInAgentToolServices> | SignedInAgentToolRequirements
> =>
  makeAgentTool(
    {
      access: "signed-in",
      scope: definition.scope,
      ...(definition.accountBudget && {
        accountBudget: definition.accountBudget,
      }),
    },
    definition,
    (run, caller) =>
      Option.match(caller, {
        // The route answers a signed-in call without a token with a 401
        // challenge before any tool runs.
        onNone: () => Effect.fail(AgentToolError.serviceUnavailable()),
        onSome: (signedIn) =>
          run.pipe(
            Effect.provide(
              customerAgentCallServices(signedIn).pipe(Layer.orDie)
            )
          ),
      })
  );

const makeAgentTool = <
  Input extends Schema.Top & { readonly DecodingServices: never },
  Output extends Schema.Codec<AgentToolResult, AgentToolResult>,
  R,
  RCall,
>(
  authorization: AgentToolAuthorization,
  definition: AgentToolDefinition<Input, Output, R>,
  provideCaller: (
    run: Effect.Effect<AgentToolResult, AgentToolError, R>,
    caller: Option.Option<CustomerAgentCaller>
  ) => Effect.Effect<AgentToolResult, AgentToolError, RCall>
): AgentTool<RCall> => {
  const decodeInput = Schema.decodeUnknownEffect(definition.input);

  return {
    ...authorization,
    name: definition.name,
    title: definition.title,
    description: definition.description,
    readOnly: definition.readOnly,
    unavailableCode: definition.unavailableCode,
    input: Schema.toStandardJSONSchemaV1(definition.input),
    output: Schema.toStandardJSONSchemaV1(
      Schema.toStandardSchemaV1(
        Schema.Union([definition.output, agentToolErrorResultSchema])
      )
    ),
    call: (args, caller = Option.none()) =>
      provideCaller(
        decodeInput(args).pipe(
          Effect.mapError((error) =>
            AgentToolError.invalidInput(getInvalidField(error.issue))
          ),
          Effect.flatMap(definition.run)
        ),
        caller
      ).pipe(
        Effect.catchDefect((defect) =>
          Effect.fail(
            AgentToolError.unavailable(definition.unavailableCode)(defect)
          )
        )
      ),
  };
};
