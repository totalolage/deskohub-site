import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAgentAuthorization } from "@/features/account";
import {
  AgentToolAdmission,
  answerAgentToolMcpRequest,
  CustomerAgentToolsLive,
  publishedCustomerAgentTools,
} from "@/features/agent-tools";
import { RequestBudget } from "@/shared/backend/request-budget/request-budget.service";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * The customer MCP server: stateless Streamable HTTP. POST carries every
 * request; GET and DELETE, which only sessions use, are answered with 405.
 * Browsers may call it only from the host serving the request. Signed-in
 * tools need a bearer access token from the Workspace OAuth server; a call
 * without a usable one is answered with an OAuth challenge. Each tool call
 * is counted by the caller's agent category.
 */
const handleMcpRequest = defineWorkspaceRoute(
  {
    operation: "agentToolsMcp",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request: Request) =>
    answerAgentToolMcpRequest({
      tools: publishedCustomerAgentTools,
      request,
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          CustomerAgentToolsLive,
          AgentToolAdmission.Default,
          CustomerAgentAuthorization.Default,
          RequestBudget.Live,
          WorkspaceDatabase.Default
        )
      ),
      Effect.mapError(WorkspaceRouteFailure.internal("The MCP request failed."))
    )
);

export {
  handleMcpRequest as DELETE,
  handleMcpRequest as GET,
  handleMcpRequest as POST,
};
