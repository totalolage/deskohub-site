import { Effect, Layer } from "effect";
import {
  AgentToolAdmission,
  type AgentToolExposure,
  answerAgentToolMcpRequest,
  CustomerAgentToolsLive,
  customerAgentTools,
  selectAgentTools,
} from "@/features/agent-tools";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
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
 * Browsers may call it only from the deployment's own origin.
 */
const handleMcpRequest = defineWorkspaceRoute(
  { operation: "agentToolsMcp", cancellation: "interrupt-on-disconnect" },
  (request: Request) =>
    getWorkspaceRuntimeCallbackOrigin.pipe(
      Effect.flatMap((origin) =>
        answerAgentToolMcpRequest({
          tools: customerTools,
          request,
          allowedOriginHostnames: [origin.hostname],
        })
      ),
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
