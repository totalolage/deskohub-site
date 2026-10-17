import { Effect, Layer } from "effect";
import {
  AgentToolAdmission,
  type AgentToolExposure,
  CustomerAgentToolsLive,
  customerAgentTools,
  makeAgentToolMcpHandler,
  selectAgentTools,
} from "@/features/agent-tools";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

/** This endpoint serves only public, read-only tools; it authenticates no one. */
const customerToolExposure: AgentToolExposure = {
  access: ["public"],
  transactional: false,
};

const customerMcpHandler = makeAgentToolMcpHandler({
  tools: selectAgentTools(customerAgentTools, customerToolExposure),
  layer: Layer.merge(CustomerAgentToolsLive, AgentToolAdmission.Default),
});

/**
 * The customer MCP server: stateless Streamable HTTP. POST carries every
 * request; GET and DELETE, which only sessions use, are answered with 405.
 */
const handleMcpRequest = defineWorkspaceRoute(
  { operation: "agentToolsMcp", cancellation: "interrupt-on-disconnect" },
  (request: Request) =>
    Effect.tryPromise({
      try: () => customerMcpHandler.fetch(request),
      catch: WorkspaceRouteFailure.internal("The MCP request failed."),
    })
);

export {
  handleMcpRequest as DELETE,
  handleMcpRequest as GET,
  handleMcpRequest as POST,
};
