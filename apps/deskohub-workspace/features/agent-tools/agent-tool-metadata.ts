/**
 * Who may call a tool: anyone, or a customer who signed in through the
 * Workspace OAuth server.
 */
const agentToolAccesses = ["public", "signed-in"] as const;

export type AgentToolAccess = (typeof agentToolAccesses)[number];

/**
 * The tool `_meta` key that publishes who may call a tool. `tools/list`
 * answers every client with the public and the signed-in tools alike, so a
 * client that sends no access token, such as the site's WebMCP
 * registration, reads it to keep only the tools it can call.
 */
export const agentToolAccessMetaKey = "cz.deskohub.workspace/access";
