import {
  type CallToolResult,
  createMcpHandler,
  McpServer,
  type StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { Effect, type Layer, Schema } from "effect";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { type AgentTool, getRequestedAgentToolLocale } from "./agent-tool";
import { AgentToolAdmission } from "./agent-tool-admission.service";
import { AgentToolError, getAgentToolErrorMessage } from "./agent-tool-error";

/** The version of the tool contract agents see; bump it on breaking changes. */
const agentToolServerVersion = "1.0.0";

const { address } = workspaceSiteConstants.location;

const agentToolServerInstructions = [
  `${workspaceSiteConstants.brand.name} is a coworking space at ${address.street}, ${address.postalCode} ${address.city}, open 24/7.`,
  "It offers cowork desks by the day, a meeting room by the hour or the day, and a private office for whole days.",
  "Use list_offerings for products and regular prices, check_availability to see whether a selection looks free, and get_quote for the exact price of a selection.",
  "Bookings are made and paid on the website: give the customer the reservation_url from a result to finish there. Availability and price are confirmed on the website before payment.",
].join(" ");

/**
 * The MCP server for a set of agent tools: stateless Streamable HTTP, one
 * server per request, answering with JSON. Each tool call runs as its own
 * Workspace Effect with `layer` and the admission check.
 */
export const makeAgentToolMcpHandler = <R, E>({
  tools,
  layer,
}: {
  readonly tools: ReadonlyArray<AgentTool<R>>;
  readonly layer: Layer.Layer<R | AgentToolAdmission, E>;
}) =>
  createMcpHandler(
    ({ requestInfo }) => {
      const server = new McpServer(
        { name: "dh-workspace", version: agentToolServerVersion },
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
            callAgentTool({
              tool,
              args,
              headers: requestInfo?.headers ?? new Headers(),
              layer,
            }).pipe(
              runWorkspaceEffect(`agentTools.${tool.name}`, {
                boundary: "route",
                signal: context.mcpReq.signal,
              })
            )
        );
      }
      return server;
    },
    { responseMode: "json" }
  );

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

const callAgentTool = <R, E>({
  tool,
  args,
  headers,
  layer,
}: {
  readonly tool: AgentTool<R>;
  readonly args: Schema.Json;
  readonly headers: Headers;
  readonly layer: Layer.Layer<R | AgentToolAdmission, E>;
}): Effect.Effect<CallToolResult> =>
  AgentToolAdmission.pipe(
    Effect.flatMap((admission) => admission.isCallAllowed(headers)),
    Effect.filterOrFail(
      (allowed) => allowed,
      () => AgentToolError.rateLimited()
    ),
    Effect.flatMap(() => tool.call(args)),
    Effect.provide(layer),
    Effect.mapError((error) =>
      error instanceof AgentToolError
        ? error
        : AgentToolError.unavailable(tool.unavailableCode)(error)
    ),
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
    withWorkspaceRequestContext(headers)
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
  const message = getAgentToolErrorMessage(error.details, locale);

  return {
    isError: true,
    content: [{ type: "text", text: message }],
    structuredContent: { error: { ...error.details, message } },
  };
};
