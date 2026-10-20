import "server-only";

import { auth } from "./auth.server";

/**
 * Serves the OAuth discovery documents agents read before they connect:
 * the authorization-server metadata (RFC 8414) and the customer MCP
 * server's protected-resource metadata (RFC 9728). The OAuth and MCP
 * plugins build both from the running configuration, so the issuer follows
 * the request host and the resource stays this deployment's MCP URL.
 * Dotted paths skip the proxy, so no locale redirect gets in the way.
 */
export const serveCustomerAgentDiscovery = (request: Request) =>
  auth.handler(request);
