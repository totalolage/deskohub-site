/**
 * RFC 9728 metadata of the customer MCP server at `/api/mcp`: the URL its
 * `WWW-Authenticate` challenges point agents to.
 */
export {
  serveCustomerAgentDiscovery as GET,
  serveCustomerAgentDiscovery as HEAD,
} from "@/features/account/server/customer-agent-discovery.server";
