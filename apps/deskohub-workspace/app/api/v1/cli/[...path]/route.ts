import { handleWorkspaceAdminApiRequest } from "@/features/admin-cli/workspace-admin-api.server";
import { defineWorkspaceHttpApiRoute } from "@/shared/backend/workspace-http-api-route";

export const GET = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceAdminApi",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request) => handleWorkspaceAdminApiRequest(request)
);

const workspaceAdminApiMutationRoute = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceAdminApi",
    cancellation: "continue-after-disconnect",
    caller: "client",
  },
  (request) => handleWorkspaceAdminApiRequest(request)
);

export {
  workspaceAdminApiMutationRoute as DELETE,
  workspaceAdminApiMutationRoute as PATCH,
  workspaceAdminApiMutationRoute as POST,
};
