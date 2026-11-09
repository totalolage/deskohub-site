/** RFC 8414 metadata of the OAuth issuer at `/api/auth`, at its path-inserted URL. */
export {
  serveCustomerAgentDiscovery as GET,
  serveCustomerAgentDiscovery as HEAD,
} from "@/features/account/server/customer-agent-discovery.server";
