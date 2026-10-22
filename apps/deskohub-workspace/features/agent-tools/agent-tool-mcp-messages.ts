import { Effect } from "effect";

/**
 * The JSON-RPC messages an MCP request carries: its single message, or each
 * message of a batch. A body that isn't JSON carries none; the MCP server
 * answers it.
 */
export const readMcpMessages = (request: Request) =>
  Effect.tryPromise(() => request.clone().json() as Promise<unknown>).pipe(
    Effect.orElseSucceed(() => null),
    Effect.map(
      (body): ReadonlyArray<unknown> => (Array.isArray(body) ? body : [body])
    )
  );
