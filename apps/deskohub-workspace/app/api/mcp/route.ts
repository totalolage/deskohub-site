import { Effect, Layer } from "effect";
import {
  AgentToolAdmission,
  type AgentToolExposure,
  answerAgentToolMcpRequest,
  CustomerAgentToolsLive,
  customerAgentTools,
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

const customerTools = selectAgentTools(
  customerAgentTools,
  customerToolExposure
);

/**
 * The customer MCP server: stateless Streamable HTTP. POST carries every
 * request; GET and DELETE, which only sessions use, are answered with 405.
 * Browsers may call it only from the host serving the request. Each tool call
 * is counted by the caller's agent category.
 */
const handleMcpRequest = defineWorkspaceRoute(
  {
    operation: "agentToolsMcp",
    cancellation: "interrupt-on-disconnect",
    caller: "client",
  },
  (request: Request) =>
    answerAgentToolMcpRequest({ tools: customerTools, request }).pipe(
      Effect.provide(
        Layer.merge(CustomerAgentToolsLive, AgentToolAdmission.Default)
      ),
      Effect.mapError(WorkspaceRouteFailure.internal("The MCP request failed."))
    )
);

export {
  handleMcpRequest as DELETE,
  handleMcpRequest as GET,
  handleMcpRequest as POST,
};
