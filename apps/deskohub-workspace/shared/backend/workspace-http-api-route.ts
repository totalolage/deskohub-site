import { Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/unstable/http";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
  type WorkspaceRouteOptions,
} from "./workspace-route";

/**
 * A Next route that hands its request to an Effect HTTP API's web handler.
 * `failureMessage` is the public message of a handler that rejects instead
 * of answering.
 */
export const defineWorkspaceHttpApiRoute = (
  {
    failureMessage,
    ...options
  }: WorkspaceRouteOptions & { readonly failureMessage: string },
  handler: (request: Request) => Promise<Response>
) =>
  defineWorkspaceRoute(options, (request) =>
    Effect.tryPromise({
      try: () => handler(request),
      catch: WorkspaceRouteFailure.internal(failureMessage),
    })
  );

/**
 * Serves every request but a GET or HEAD without the caller's abort signal,
 * so a mutation runs to completion after its client disconnects. Effect's
 * web handler interrupts the request's fiber when `request.signal` aborts,
 * whatever the route's `cancellation` says, so a
 * `"continue-after-disconnect"` route alone doesn't keep a mutation going.
 * A GET or HEAD still stops with its client.
 */
export const continueMutationsAfterDisconnect =
  (handler: (request: Request) => Promise<Response>) =>
  (request: Request): Promise<Response> =>
    handler(
      request.method === "GET" || request.method === "HEAD"
        ? request
        : new Request(request, { signal: null })
    );

/**
 * Marks every routed response `Cache-Control: private, no-store`, for an
 * HTTP API whose answers belong to one caller.
 */
export const privateNoStoreResponses = HttpRouter.middleware(
  (effect) =>
    Effect.map(effect, (response) =>
      HttpServerResponse.setHeader(
        response,
        "Cache-Control",
        "private, no-store"
      )
    ),
  { global: true }
);
