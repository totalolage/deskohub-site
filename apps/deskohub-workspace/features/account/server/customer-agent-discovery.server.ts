import "server-only";

import { connection } from "next/server";
import { auth } from "./auth.server";

/**
 * Serves the OAuth discovery documents agents read before they connect:
 * the authorization-server metadata (RFC 8414) and the customer MCP
 * server's protected-resource metadata (RFC 9728). The OAuth and MCP
 * plugins build both from the running configuration, so the issuer follows
 * the request host and the resource stays this deployment's MCP URL.
 * Dotted paths skip the proxy, so no locale redirect gets in the way.
 *
 * The documents are rendered per request, never at build time: the issuer
 * depends on the request host, and the build runs before migrations create
 * the OAuth tables.
 */
export const serveCustomerAgentDiscovery = async (request: Request) => {
  await connection();
  return auth.handler(request);
};
