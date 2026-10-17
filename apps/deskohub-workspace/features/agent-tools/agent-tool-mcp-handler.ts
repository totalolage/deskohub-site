import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
  originValidationResponse,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { Effect, FiberSet, Option, Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { type AgentTool, getRequestedAgentToolLocale } from "./agent-tool";
import { AgentToolAdmission } from "./agent-tool-admission.service";
import { AgentToolError, toAgentToolErrorResult } from "./agent-tool-error";

/** The version of the tool contract agents see; bump it on breaking changes. */
const agentToolServerVersion = "1.0.0";

const { address } = workspaceSiteConstants.location;

const agentToolServerInstructions = [
  `${workspaceSiteConstants.brand.name} is a coworking space at ${address.street}, ${address.postalCode} ${address.city}, open 24/7.`,
  "It offers cowork desks by the day, a meeting room by the hour or the day, and a private office for whole days.",
  "Use list_offerings for products with their regular and today's advertised prices, check_availability to see whether a selection looks free, and get_quote for the exact price of a selection.",
  "Bookings are made and paid on the website: give the customer the reservation_url from a result to finish there. Availability and price are confirmed on the website before payment.",
].join(" ");

/**
 * Answers one MCP request with a set of agent tools: stateless Streamable
 * HTTP with a fresh server per request. Tools emit no progress messages, so
 * the SDK answers 2026-era calls with JSON. A request whose
 * `Origin` names another site is rejected with 403; clients that send no
 * `Origin`, such as hosted agent connectors, are served.
 *
 * Tool calls run as fibers of the returned Effect, so they share its
 * services, request context, and trace, and are interrupted with it.
 */
export const answerAgentToolMcpRequest = <R>({
  tools,
  request,
  allowedOriginHostnames,
}: {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly request: Request;
  /** Hostnames a browser `Origin` may name, such as the deployment's own. */
  readonly allowedOriginHostnames: ReadonlyArray<string>;
}) =>
  Option.fromNullishOr(
    originValidationResponse(request, [...allowedOriginHostnames])
  ).pipe(
    Option.match({
      onSome: (rejection) =>
        Effect.logWarning(
          "Agent tool MCP request from another origin was rejected"
        ).pipe(Effect.as(rejection)),
      onNone: () => serveAgentToolMcpRequest({ tools, request }),
    })
  );

const serveAgentToolMcpRequest = <R>({
  tools,
  request,
}: {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly request: Request;
}) =>
  Effect.Do.pipe(
    Effect.bind("runInRequest", () =>
      FiberSet.makeRuntimePromise<R | AgentToolAdmission>()
    ),
    Effect.bind("handler", ({ runInRequest }) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          createMcpHandler(
            () =>
              makeAgentToolMcpServer({
                tools,
                headers: request.headers,
                runInRequest,
              }),
            {
              onerror: (cause) =>
                void runInRequest(
                  Effect.logError("Agent tool MCP request failed", { cause })
                ),
            }
          )
        ),
        (handler) => Effect.promise(() => handler.close())
      )
    ),
    Effect.flatMap(({ handler }) =>
      Effect.tryPromise(() => handler.fetch(request))
    ),
    Effect.scoped
  );

/** Runs an Effect as a fiber of the request that serves the MCP exchange. */
type RequestRunner<R> = <A>(
  effect: Effect.Effect<A, never, R>,
  options?: Effect.RunOptions
) => Promise<A>;

const makeAgentToolMcpServer = <R>({
  tools,
  headers,
  runInRequest,
}: {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly headers: Headers;
  readonly runInRequest: RequestRunner<R | AgentToolAdmission>;
}) => {
  const server = new McpServer(
    {
      name: "dh-workspace",
      title: workspaceSiteConstants.brand.name,
      version: agentToolServerVersion,
    },
    { instructions: agentToolServerInstructions }
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: acceptArguments(tool.input),
        outputSchema: tool.output,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          idempotentHint: tool.readOnly,
          openWorldHint: false,
        },
      },
      (args, context) =>
        runInRequest(callAgentTool({ tool, args, headers }), {
          signal: context.mcpReq.signal,
        })
    );
  }
  return server;
};

const jsonArguments = Schema.toStandardSchemaV1(Schema.Json);

/**
 * Publishes the tool's input JSON Schema but checks only that the arguments
 * are JSON, leaving validation to the tool: it answers invalid arguments with
 * a typed, localized error instead of the SDK's English message.
 */
const acceptArguments = (
  input: StandardJSONSchemaV1
): StandardSchemaWithJSON<Schema.Json, Schema.Json> => ({
  "~standard": {
    version: 1,
    vendor: input["~standard"].vendor,
    jsonSchema: input["~standard"].jsonSchema,
    validate: jsonArguments["~standard"].validate,
  },
});

const callAgentTool = <R>({
  tool,
  args,
  headers,
}: {
  readonly tool: AgentTool<R>;
  readonly args: Schema.Json;
  readonly headers: Headers;
}): Effect.Effect<CallToolResult, never, R | AgentToolAdmission> =>
  AgentToolAdmission.pipe(
    Effect.flatMap((admission) => admission.isCallAllowed(headers)),
    Effect.mapError(() => AgentToolError.serviceUnavailable()),
    Effect.filterOrFail(
      (allowed) => allowed,
      () => AgentToolError.rateLimited()
    ),
    Effect.flatMap(() => tool.call(args)),
    Effect.map(
      (result): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      })
    ),
    Effect.catchTag("AgentToolError", (error) =>
      reportAgentToolError(error).pipe(
        Effect.as(toToolErrorResult(error, getRequestedAgentToolLocale(args)))
      )
    ),
    Effect.annotateLogs({ agentTool: tool.name }),
    Effect.withSpan(`agentTools.${tool.name}`)
  );

const reportAgentToolError = (error: AgentToolError) =>
  error.cause === undefined
    ? Effect.logInfo("Agent tool call was rejected", { code: error.code })
    : Effect.logError("Agent tool call failed", {
        code: error.code,
        cause: error.cause,
      });

const toToolErrorResult = (
  error: AgentToolError,
  locale: ReturnType<typeof getRequestedAgentToolLocale>
): CallToolResult => {
  const result = toAgentToolErrorResult(error.details, locale);

  return {
    isError: true,
    content: [{ type: "text", text: result.error.message }],
    structuredContent: result,
  };
};
