import { respondWithWorkspaceLocationMap } from "@/shared/backend/workspace-location-map-response";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";
import { workspaceLocationMapImagePath } from "@/shared/utils";

export const GET = defineWorkspaceRoute(
  {
    operation: "workspaceLocationMap.get",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request) =>
    respondWithWorkspaceLocationMap(request, {
      canonicalPath: workspaceLocationMapImagePath,
      contentType: "image/jpeg",
    })
);
