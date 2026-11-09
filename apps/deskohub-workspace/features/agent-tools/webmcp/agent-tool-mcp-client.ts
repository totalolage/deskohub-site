import { Data, Effect, Exit, Schema } from "effect";
import {
  agentToolAccessMetaKey,
  registersAsSiteTool,
} from "../agent-tool-metadata";

const agentToolEndpoint = "/api/mcp";

/** A request to `/api/mcp` failed in transport, HTTP, or JSON-RPC. */
export class AgentToolRequestError extends Data.TaggedError(
  "AgentToolRequestError"
)<{ readonly cause?: unknown; readonly status?: number }> {}

// A published tool input is a JSON Schema object; registration passes every
// keyword through, so decoding keeps the ones not named here.
const publishedInputSchemaSchema = Schema.Struct({
  type: Schema.Literal("object"),
  properties: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});

const publishedAgentToolSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.String,
  inputSchema: publishedInputSchemaSchema,
  _meta: Schema.optionalKey(
    Schema.Struct({
      [agentToolAccessMetaKey]: Schema.optionalKey(Schema.String),
      ui: Schema.optionalKey(
        Schema.Struct({ resourceUri: Schema.optionalKey(Schema.String) })
      ),
    })
  ),
});

/** An agent tool as `/api/mcp` publishes it in `tools/list`. */
export type PublishedAgentTool = typeof publishedAgentToolSchema.Type;

/** Whether the site registers a published tool (`registersAsSiteTool`). */
export const isSiteTool = ({ _meta }: PublishedAgentTool) =>
  registersAsSiteTool({
    access: _meta?.[agentToolAccessMetaKey],
    viewUri: _meta?.ui?.resourceUri,
  });

const toolsListResponseSchema = Schema.Struct({
  result: Schema.Struct({ tools: Schema.Array(publishedAgentToolSchema) }),
});

// The typed error a tool returns instead of a result: a `code`, a localized
// `message`, and any details the tool adds.
const agentToolCallErrorSchema = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
});

const toolCallResponseSchema = Schema.Struct({
  result: Schema.Union([
    Schema.Struct({
      isError: Schema.Literal(true),
      structuredContent: agentToolCallErrorSchema,
    }),
    Schema.Struct({
      isError: Schema.optionalKey(Schema.Literal(false)),
      structuredContent: Schema.Unknown,
    }),
  ]),
});

/**
 * A minimal same-origin client for the stateless `/api/mcp` endpoint. It sends
 * sessionless JSON-RPC requests, which the endpoint answers without
 * `initialize`, so the browser needs no MCP SDK for two methods.
 */
export const listAgentTools = postAgentToolRequest(
  toolsListResponseSchema,
  "tools/list",
  {}
).pipe(Effect.map(({ result }) => result.tools));

export const callAgentTool = (name: string, input: Schema.JsonObject) =>
  postAgentToolRequest(toolCallResponseSchema, "tools/call", {
    name,
    arguments: input,
  }).pipe(Effect.map(({ result }) => result));

function postAgentToolRequest<S extends Schema.Top>(
  responseSchema: S,
  method: string,
  params: Schema.JsonObject
) {
  // One controller spans the headers and the body, so an interruption or
  // failure before the body is read aborts the request.
  return Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (request, exit) =>
      Exit.isSuccess(exit) ? Effect.void : Effect.sync(() => request.abort())
  ).pipe(
    Effect.flatMap((request) =>
      Effect.tryPromise({
        try: () =>
          fetch(agentToolEndpoint, {
            method: "POST",
            headers: {
              Accept: "application/json, text/event-stream",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            credentials: "same-origin",
            signal: request.signal,
          }),
        catch: (cause) => new AgentToolRequestError({ cause }),
      })
    ),
    Effect.filterOrFail(
      (response) => response.ok,
      (response) => new AgentToolRequestError({ status: response.status })
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.text(),
        catch: (cause) => new AgentToolRequestError({ cause }),
      })
    ),
    Effect.scoped,
    Effect.map(getJsonRpcMessage),
    Effect.flatMap((message) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(responseSchema), {
        // Tool errors carry details such as a date range beside the code.
        onExcessProperty: "preserve",
      })(message)
    ),
    Effect.mapError((cause) =>
      cause instanceof AgentToolRequestError
        ? cause
        : new AgentToolRequestError({ cause })
    )
  );
}

/**
 * The endpoint answers with a JSON body or a single-message event stream,
 * depending on the protocol leg; the stream's message is its last `data:`
 * line.
 */
function getJsonRpcMessage(body: string) {
  const data = body.split("\n").findLast((line) => line.startsWith("data:"));
  return data === undefined ? body : data.slice("data:".length);
}
