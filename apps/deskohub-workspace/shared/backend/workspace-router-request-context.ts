import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { withWorkspaceRequestContext } from "./workspace-request-context";

/**
 * Serves each request an Effect router routes in that request's own context,
 * as `withWorkspaceRequestContext` gives a Next route or action: its
 * headers, consented visitor, and agent category. A handler from
 * `toWorkspaceWebHandler` runs outside Next's request scope, so without this
 * Layer `currentRequestHeaders` there falls back to Next's request store.
 * An HTTP adapter merges it into the API Layer it hands
 * `toWorkspaceWebHandler`, beside its routes. A request no route matches
 * skips global middleware and runs no handler.
 */
export const WorkspaceRouterRequestContext = HttpRouter.middleware(
  (effect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      effect.pipe(withWorkspaceRequestContext(new Headers(request.headers)))
    ),
  { global: true }
);
