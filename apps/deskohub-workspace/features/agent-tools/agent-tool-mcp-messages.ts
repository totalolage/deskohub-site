import { Effect } from "effect";

/**
 * An MCP request with the JSON-RPC messages its body carries: its single
 * message, or each message of a batch. A body that isn't JSON carries none;
 * the MCP server answers it.
 */
export interface McpRequest {
  readonly request: Request;
  readonly messages: ReadonlyArray<unknown>;
}

/**
 * Reads the request's messages once, for everything that routes it before
 * the MCP server. The body stays unread for the server.
 */
export const readMcpRequest = (request: Request): Effect.Effect<McpRequest> =>
  Effect.tryPromise(() => request.clone().json() as Promise<unknown>).pipe(
    Effect.orElseSucceed(() => null),
    Effect.map((body) => ({
      request,
      messages: Array.isArray(body) ? body : [body],
    }))
  );
