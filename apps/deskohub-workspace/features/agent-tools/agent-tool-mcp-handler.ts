import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
  originValidationResponse,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import {
  Context,
  Effect,
  Exit,
  FiberSet,
  Match,
  Option,
  Schema,
  Scope,
  Stream,
} from "effect";
import { scheduleAgentTrafficEvent } from "@/shared/backend/agent-traffic/agent-traffic-events";
import type { RequestBudget } from "@/shared/backend/request-budget/request-budget.service";
import { CurrentAgentTraffic } from "@/shared/backend/workspace-request-context";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { currentInstant } from "@/shared/utils/temporal";
import { type AgentTool, getRequestedAgentToolLocale } from "./agent-tool";
import { AgentToolAdmission } from "./agent-tool-admission.service";
import { spendSignedInCallBudgets } from "./agent-tool-call-budget";
import {
  AgentToolError,
  type AgentToolErrorCode,
  toAgentToolErrorResult,
} from "./agent-tool-error";
import { authorizeAgentToolRequest } from "./agent-tool-mcp-authorization";
import type { CustomerAgentCaller } from "./customer-agent-caller";

/** The version of the tool contract agents see; bump it on breaking changes. */
const agentToolServerVersion = "1.0.0";

const { address } = workspaceSiteConstants.location;

const agentToolServerInstructions = [
  `${workspaceSiteConstants.brand.name} is a coworking space at ${address.street}, ${address.postalCode} ${address.city}, open 24/7.`,
  "It offers cowork desks by the day, a meeting room by the hour or the day, and a private office for whole days.",
  "Use list_offerings for products with their regular and today's advertised prices, check_availability to see whether a selection looks free, and get_quote for the exact price of a selection.",
  "Bookings are made and paid on the website: give the customer the reservation_url from a result to finish there. Availability and price are confirmed on the website before payment.",
  "With the customer signed in, start_reservation holds a selection for them and returns a pay_url where they accept the terms and pay; get_reservation_status and list_my_reservations show their own reservations. The tools can't pay, cancel, or change a reservation.",
].join(" ");

/**
 * Answers one MCP request with a set of agent tools: stateless Streamable
 * HTTP with a fresh server per request. Tools emit no progress messages, so
 * the SDK answers 2026-era calls with JSON. A browser may call only from the
 * host that serves the request, so a request whose `Origin` names another
 * site is rejected with 403. Clients that send no `Origin`, such as hosted
 * agent connectors, are served.
 *
 * The host comes from the request itself, so every domain and alias of the
 * deployment serves its own pages. That guards against DNS rebinding only
 * where the platform routes no foreign hostname to the deployment, as Vercel
 * routes only a project's own domains.
 *
 * An agent may send an OAuth bearer token. A token that grants nothing,
 * or a signed-in tool called without a token granting its scope, is answered
 * with a 401 or 403 OAuth challenge before the MCP server runs.
 *
 * Tool calls run as fibers of the returned Effect, so they share its
 * services, request context, and trace, and are interrupted with it.
 */
export const answerAgentToolMcpRequest = <R>({
  tools,
  request,
}: {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly request: Request;
}) =>
  Option.fromNullishOr(
    originValidationResponse(request, [new URL(request.url).hostname])
  ).pipe(
    Option.match({
      onSome: (rejection) =>
        Effect.logWarning(
          "Agent tool MCP request from another origin was rejected"
        ).pipe(Effect.as(rejection)),
      onNone: () =>
        authorizeAgentToolRequest({ tools, request }).pipe(
          Effect.flatMap((caller) =>
            serveAgentToolMcpRequest({ tools, request, caller })
          ),
          Effect.catchTag("AgentToolRequestRefused", ({ response }) =>
            Effect.succeed(response)
          )
        ),
    })
  );

/**
 * Serves the request in a scope that stays open until its response body ends
 * or the client cancels it: a 2025-era call answers with an event stream
 * before the tool has finished, and closing the scope interrupts the tool.
 */
const serveAgentToolMcpRequest = <R>(exchange: McpExchange<R>) =>
  Effect.Do.pipe(
    Effect.bind("scope", () => Scope.make()),
    Effect.bind("response", ({ scope }) =>
      exchangeAgentToolMcpRequest(exchange).pipe(
        Scope.provide(scope),
        Effect.onExit((exit) =>
          Exit.isSuccess(exit) ? Effect.void : Scope.close(scope, exit)
        )
      )
    ),
    Effect.flatMap(closeScopeAfterBody)
  );

/** One MCP request and the tools and caller it is served with. */
type McpExchange<R> = {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly request: Request;
  readonly caller: Option.Option<CustomerAgentCaller>;
};

type ToolCallServices<R> = R | AgentToolAdmission | RequestBudget;

const exchangeAgentToolMcpRequest = <R>({
  tools,
  request,
  caller,
}: McpExchange<R>) =>
  Effect.Do.pipe(
    Effect.bind("runInRequest", () =>
      FiberSet.makeRuntimePromise<ToolCallServices<R>>()
    ),
    Effect.bind("handler", ({ runInRequest }) =>
      Effect.acquireRelease(
        Effect.sync(() =>
          createMcpHandler(
            () =>
              makeAgentToolMcpServer({
                tools,
                headers: request.headers,
                caller,
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
    )
  );

/** The response, with `scope` closed once its body ends or is cancelled. */
const closeScopeAfterBody = ({
  scope,
  response,
}: {
  readonly scope: Scope.Closeable;
  readonly response: Response;
}) =>
  Option.fromNullishOr(response.body).pipe(
    Option.match({
      onNone: () => Scope.close(scope, Exit.void).pipe(Effect.as(response)),
      onSome: (body) =>
        Effect.succeed(
          new Response(
            Stream.fromReadableStream({
              evaluate: () => body,
              onError: (cause) => cause,
            }).pipe(
              Stream.ensuring(Scope.close(scope, Exit.void)),
              Stream.toReadableStreamWith(Context.empty())
            ),
            response
          )
        ),
    })
  );

/** Runs an Effect as a fiber of the request that serves the MCP exchange. */
type RequestRunner<R> = <A>(
  effect: Effect.Effect<A, never, R>,
  options?: Effect.RunOptions
) => Promise<A>;

const makeAgentToolMcpServer = <R>({
  tools,
  headers,
  caller,
  runInRequest,
}: {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly headers: Headers;
  readonly caller: Option.Option<CustomerAgentCaller>;
  readonly runInRequest: RequestRunner<ToolCallServices<R>>;
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
        runInRequest(callAgentTool({ tool, args, headers, caller }), {
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
  caller,
}: {
  readonly tool: AgentTool<R>;
  readonly args: Schema.Json;
  readonly headers: Headers;
  readonly caller: Option.Option<CustomerAgentCaller>;
}): Effect.Effect<CallToolResult, never, ToolCallServices<R>> =>
  AgentToolAdmission.pipe(
    Effect.flatMap((admission) => admission.isCallAllowed(headers)),
    Effect.mapError(() => AgentToolError.serviceUnavailable()),
    Effect.filterOrFail(
      (allowed) => allowed,
      () => AgentToolError.rateLimited()
    ),
    Effect.andThen(spendCallBudgets({ tool, caller })),
    Effect.flatMap(() => tool.call(args, caller)),
    Effect.map(
      (result): CallToolResult => ({
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
      })
    ),
    Effect.tap(() => recordAgentToolCall(tool.name, "success")),
    Effect.catchTag("AgentToolError", (error) =>
      reportAgentToolError(error).pipe(
        Effect.andThen(recordAgentToolCall(tool.name, error.code)),
        Effect.as(toToolErrorResult(error, getRequestedAgentToolLocale(args)))
      )
    ),
    Effect.annotateLogs({ agentTool: tool.name }),
    Effect.withSpan(`agentTools.${tool.name}`)
  );

/**
 * A signed-in call spends its grant's and account's budgets; public tools
 * stay bounded by the per-IP rule alone.
 */
const spendCallBudgets = <R>({
  tool,
  caller,
}: {
  readonly tool: AgentTool<R>;
  readonly caller: Option.Option<CustomerAgentCaller>;
}) =>
  Match.value(tool).pipe(
    Match.discriminatorsExhaustive("access")({
      public: () => Effect.void,
      "signed-in": (signedInTool) =>
        Option.match(caller, {
          onNone: () => Effect.void,
          onSome: ({ grant }) =>
            spendSignedInCallBudgets({ grant, tool: signedInTool }),
        }),
    })
  );

/** Counts the call by the caller's agent category, after the response. */
const recordAgentToolCall = (
  tool: string,
  outcome: "success" | AgentToolErrorCode
) =>
  Effect.all({ traffic: CurrentAgentTraffic, timestamp: currentInstant }).pipe(
    Effect.flatMap(({ traffic, timestamp }) =>
      scheduleAgentTrafficEvent({
        event: "agent tool call",
        traffic,
        properties: { tool, outcome },
        timestamp,
      })
    )
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
