/**
 * Where the OAuth server sends a customer who connects an AI agent: the
 * sign-in step, then the consent step. The proxy places both on the
 * customer's locale.
 */
export const customerAgentSignInPath = "/auth/connect";
export const customerAgentConsentPath = "/auth/consent";

/** The customer MCP server's path on every Workspace host. */
export const customerMcpServerPath = "/api/mcp";
