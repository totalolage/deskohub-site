import { handleWorkspaceCustomerApiRequest } from "@/features/customer-api/customer-api.server";
import { defineWorkspaceHttpApiRoute } from "@/shared/backend/workspace-http-api-route";

const failureMessage = "The customer API request could not be completed.";

export const GET = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceCustomerApi",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
    failureMessage,
  },
  (request) => handleWorkspaceCustomerApiRequest(request)
);

const workspaceCustomerApiMutationRoute = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceCustomerApi",
    cancellation: "continue-after-disconnect",
    caller: "client",
    failureMessage,
  },
  (request) => handleWorkspaceCustomerApiRequest(request)
);

export {
  workspaceCustomerApiMutationRoute as DELETE,
  workspaceCustomerApiMutationRoute as PATCH,
  workspaceCustomerApiMutationRoute as POST,
  workspaceCustomerApiMutationRoute as PUT,
};
