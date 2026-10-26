import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAgentAuthorization } from "@/features/account";
import {
  AdministrationAgentAccess,
  AdministrationAgentToolsLive,
} from "@/features/administration-agent-tools";
import {
  AgentToolAdmission,
  answerAgentToolMcpRequest,
  CustomerAgentToolsLive,
  customerAgentCatalog,
  identifyAgentToolClient,
  readMcpRequest,
} from "@/features/agent-tools";
import { RequestBudget } from "@/shared/backend/request-budget/request-budget.service";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/**
 * The customer MCP server: stateless Streamable HTTP. POST carries every
 * request; GET and DELETE, which only sessions use, are answered with 405.
 * Browsers may call it only from the host serving the request. Every client
 * sees every tool, with the instructions for them, as `customerAgentCatalog`
 * lists them: ChatGPT's `start_reservation` only links the prefilled
 * reservation page. Signed-in
 * tools need a bearer access token from the Workspace OAuth server; a call
 * without a usable one is answered with an OAuth challenge. Each tool call
 * is counted by the caller's agent category.
 *
 * An administrator's agent also sees the administration tools, after the
 * customer tools, when its token carries the administration scope and its
 * account holds the administrator grant at that moment. When the grant
 * can't be checked the request is answered with 503, never with the tools.
 */
const handleMcpRequest = defineWorkspaceRoute(
  {
    operation: "agentToolsMcp",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request: Request) =>
    readMcpRequest(request).pipe(
      Effect.flatMap((mcpRequest) => {
        const client = identifyAgentToolClient(mcpRequest);
        return answerAgentToolMcpRequest({
          ...customerAgentCatalog.forClient(client),
          // Appended after the customer tools, never adapted per client.
          callerTools: AdministrationAgentAccess.forCaller,
          client,
          request: mcpRequest,
        });
      }),
      Effect.catchTag("AdministrationAgentAccessUnavailable", () =>
        Effect.succeed(
          new Response(null, {
            status: 503,
            headers: { "cache-control": "no-store", "retry-after": "5" },
          })
        )
      ),
      Effect.provide(
        Layer.mergeAll(
          CustomerAgentToolsLive,
          AdministrationAgentToolsLive,
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
