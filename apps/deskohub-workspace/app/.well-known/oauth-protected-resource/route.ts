/** RFC 9728 metadata of the customer MCP server, at the root well-known URL. */
export {
  serveCustomerAgentDiscovery as GET,
  serveCustomerAgentDiscovery as HEAD,
} from "@/features/account/server/customer-agent-discovery.server";
