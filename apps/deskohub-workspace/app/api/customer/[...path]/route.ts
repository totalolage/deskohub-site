import { handleWorkspaceCustomerApiRequest } from "@/features/customer-api/customer-api.server";
import { defineWorkspaceHttpApiRoute } from "@/shared/backend/workspace-http-api-route";

/**
 * Every method waits for the API's handler, which decides what a disconnect
 * stops: a mutation, or a GET's call that provisions or finalizes, runs to
 * completion, while an ordinary read stops with its client.
 */
const workspaceCustomerApiRoute = defineWorkspaceHttpApiRoute(
  {
    operation: "workspaceCustomerApi",
    cancellation: "continue-after-disconnect",
    caller: "client",
    failureMessage: "The customer API request could not be completed.",
  },
  (request) => handleWorkspaceCustomerApiRequest(request)
);

export {
  workspaceCustomerApiRoute as DELETE,
  workspaceCustomerApiRoute as GET,
  workspaceCustomerApiRoute as PATCH,
  workspaceCustomerApiRoute as POST,
  workspaceCustomerApiRoute as PUT,
};
