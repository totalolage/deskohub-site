import { handleWorkspaceAdminApiRequest } from "@/features/admin-cli/workspace-admin-api.server";
import { defineWorkspaceHttpApiRoute } from "@/shared/backend/workspace-http-api-route";

export const GET = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceAdminApi",
    cancellation: "interrupt-on-disconnect",
  },
  (request) => handleWorkspaceAdminApiRequest(request)
);

const workspaceAdminApiMutationRoute = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceAdminApi",
    cancellation: "continue-after-disconnect",
  },
  (request) => handleWorkspaceAdminApiRequest(request)
);

export const DELETE = workspaceAdminApiMutationRoute;
export const PATCH = workspaceAdminApiMutationRoute;
export const POST = workspaceAdminApiMutationRoute;
