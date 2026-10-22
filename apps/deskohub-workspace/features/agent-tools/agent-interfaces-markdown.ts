import type { ListItem } from "mdast";
import {
  customerAgentDiscoveryPaths,
  customerMcpServerPath,
} from "@/features/account/customer-agent-routes";
import type { GlobalRelease } from "@/features/feature-flags/backend/global-release";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInlineCode,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import { getWorkspaceCanonicalUrl } from "@/shared/utils/site-constants";
import type { AgentTool, AgentToolAuthorization } from "./agent-tool";
import { agentToolBookingGuidance } from "./agent-tool-guidance";
import { registersAsSiteTool } from "./agent-tool-metadata";
import {
  prepareReservationToolDescription,
  prepareReservationToolName,
} from "./webmcp/prepare-reservation-site-tool-description";

/** A tool as the MCP server publishes it: its copy, access and view. */
export type DescribedAgentTool = Pick<
  AgentTool<never>,
  "name" | "title" | "description" | "view"
> &
  AgentToolAuthorization;

/** The agent interfaces the site offers, as `llms.txt` describes them. */
export interface AgentInterfaces {
  /** The tools the customer MCP server publishes. */
  readonly tools: ReadonlyArray<DescribedAgentTool>;
  readonly siteToolsRelease: GlobalRelease;
}

export const agentInterfacesHeading = "AI agents";

/** The section's parts, each under its own heading. */
export const agentInterfacesSubheadings = {
  mcpServer: "MCP server",
  publicTools: "Public tools",
  signedInTools: "Signed-in tools",
  siteTools: "WebMCP site tools",
} as const;

const toolItem = (tool: DescribedAgentTool): ListItem =>
  markdownListItem(
    markdownInlineCode(tool.name),
    ` (${tool.title}`,
    ...(tool.access === "signed-in"
      ? ["; scope ", markdownInlineCode(tool.scope)]
      : []),
    `): ${tool.description}`
  );

const toolSection = (
  heading: string,
  intro: string,
  items: ReadonlyArray<ListItem>
): MarkdownBlocks =>
  items.length > 0
    ? [
        markdownHeading(3, heading),
        markdownParagraph(intro),
        markdownList(items),
      ]
    : [];

const siteToolsIntro = {
  on: "In a browser that supports WebMCP, the site's pages register these tools for an agent working in the page:",
  undecided:
    "In a browser that supports WebMCP, the site's pages may register these tools for an agent working in the page; the tools the browser lists are the ones available:",
} satisfies Record<Exclude<GlobalRelease, "off">, string>;

/**
 * The site tools a page registers: the published tools the site registers,
 * as `isSiteTool` selects them from `tools/list`, and `prepare_reservation`
 * on the reservation pages. Nothing while the site tools are off for every
 * visitor.
 */
const siteToolsMarkdown = ({
  tools,
  siteToolsRelease,
}: AgentInterfaces): MarkdownBlocks =>
  siteToolsRelease === "off"
    ? []
    : toolSection(
        agentInterfacesSubheadings.siteTools,
        siteToolsIntro[siteToolsRelease],
        [
          ...tools
            .filter((tool) =>
              registersAsSiteTool({
                access: tool.access,
                viewUri: tool.view?.uri,
              })
            )
            .map((tool) =>
              markdownListItem(
                markdownInlineCode(tool.name),
                `: ${tool.description}`
              )
            ),
          markdownListItem(
            markdownInlineCode(prepareReservationToolName),
            ` (reservation pages only): ${prepareReservationToolDescription}`
          ),
        ]
      );

/**
 * The `llms.txt` section on the agent interfaces: the MCP server and how to
 * sign in, its tools by who may call them, and the WebMCP site tools. The
 * tools come from the definitions the server publishes.
 */
export const agentInterfacesMarkdown = (
  interfaces: AgentInterfaces
): MarkdownBlocks => {
  const mcpServerUrl = getWorkspaceCanonicalUrl(customerMcpServerPath);
  const { tools } = interfaces;

  return [
    markdownHeading(2, agentInterfacesHeading),
    markdownParagraph(agentToolBookingGuidance.join(" ")),
    markdownHeading(3, agentInterfacesSubheadings.mcpServer),
    markdownList([
      markdownListItem(
        "Endpoint: ",
        markdownLink(mcpServerUrl, mcpServerUrl),
        " (Streamable HTTP, stateless: send every request as a POST)"
      ),
      markdownListItem(
        "Sign-in: OAuth 2.1 with the customer's account. The ",
        markdownLink(
          getWorkspaceCanonicalUrl(
            customerAgentDiscoveryPaths.protectedResource
          ),
          "protected resource metadata"
        ),
        " (RFC 9728) names the authorization server, whose ",
        markdownLink(
          getWorkspaceCanonicalUrl(
            customerAgentDiscoveryPaths.authorizationServer
          ),
          "metadata"
        ),
        " (RFC 8414) lists its endpoints."
      ),
    ]),
    ...toolSection(
      agentInterfacesSubheadings.publicTools,
      "Any agent may call these, without signing in.",
      tools.filter((tool) => tool.access === "public").map(toolItem)
    ),
    ...toolSection(
      agentInterfacesSubheadings.signedInTools,
      "These need an access token from the customer's sign-in that grants the tool's scope.",
      tools.filter((tool) => tool.access === "signed-in").map(toolItem)
    ),
    ...siteToolsMarkdown(interfaces),
  ];
};
