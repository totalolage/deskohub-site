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
        : withoutAbortSignal(request)
    );

/**
 * A request's init with its body streamed. The runtimes require `duplex` for
 * a stream body, though the DOM types don't declare it.
 */
type StreamedRequestInit = RequestInit & { readonly duplex: "half" };

/**
 * The request without its abort signal, rebuilt from its parts: Next.js
 * hands an app route its request behind a Proxy, which `new Request(request)`
 * can't copy.
 */
const withoutAbortSignal = (request: Request) => {
  const init: StreamedRequestInit = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    duplex: "half",
  };
  return new Request(request.url, init);
};

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
