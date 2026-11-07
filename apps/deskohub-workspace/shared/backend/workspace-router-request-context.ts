import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/unstable/http";
import { withWorkspaceRequestContext } from "./workspace-request-context";

/**
 * Serves every request an Effect router handles in that request's own
 * context, as `withWorkspaceRequestContext` gives a Next route or action: its
 * headers, consented visitor, and agent category. A handler from
 * `toWorkspaceWebHandler` runs outside Next's request scope, so without this
 * Layer `currentRequestHeaders` there falls back to Next's request store and
 * fails or reads another request. Each HTTP adapter adds it to the API Layer
 * it serves, as the customer API does.
 */
export const WorkspaceRouterRequestContext = HttpRouter.middleware(
  (effect) =>
    Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
      effect.pipe(withWorkspaceRequestContext(new Headers(request.headers)))
    ),
  { global: true }
);
