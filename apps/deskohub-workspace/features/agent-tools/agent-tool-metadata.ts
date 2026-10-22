/**
 * Who may call a tool: anyone, a customer who signed in through the
 * Workspace OAuth server, or an administrator's agent.
 */
const agentToolAccesses = ["public", "signed-in", "administration"] as const;

export type AgentToolAccess = (typeof agentToolAccesses)[number];

/**
 * The tool `_meta` key that publishes who may call a tool. `tools/list`
 * answers every client with the public and the signed-in tools alike, so a
 * client that sends no access token, such as the site's WebMCP
 * registration, reads it to keep only the tools it can call. Administration
 * tools are listed only to an administrator's agent.
 */
export const agentToolAccessMetaKey = "cz.deskohub.workspace/access";

/**
 * Whether the site registers a tool as a WebMCP site tool. The page sends no
 * access token, so only public tools answer it, and a tool whose result
 * renders an MCP Apps view needs a host that renders the view. The browser
 * reads both facts from `tools/list`; the server from the tool definitions.
 */
export const registersAsSiteTool = ({
  access,
  viewUri,
}: {
  readonly access: string | undefined;
  readonly viewUri: string | undefined;
}) => access === "public" && viewUri === undefined;
