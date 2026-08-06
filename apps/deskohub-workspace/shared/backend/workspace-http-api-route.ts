import { Effect } from "effect";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
  type WorkspaceRouteOptions,
} from "./workspace-route";

export const defineWorkspaceHttpApiRoute = (
  options: WorkspaceRouteOptions,
  handler: (request: Request) => Promise<Response>
) =>
  defineWorkspaceRoute(options, (request) =>
    Effect.tryPromise({
      try: () => handler(request),
      catch: WorkspaceRouteFailure.internal(
        "The administration API request could not be completed."
      ),
    })
  );
