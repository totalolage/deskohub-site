import { RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";

export { RESOURCE_MIME_TYPE as agentToolViewMimeType } from "@modelcontextprotocol/ext-apps/server";

/**
 * An MCP Apps view a tool's result renders in: one self-contained HTML
 * document, served as a `ui://` resource. Hosts cache a view by its URI, so
 * a breaking change to the document publishes a new URI.
 */
export interface AgentToolView {
  readonly uri: `ui://${string}`;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly html: string;
}

/**
 * The tool `_meta` that links a tool to the view its result renders in:
 * the MCP Apps key, its deprecated flat form, and ChatGPT's alias.
 */
export const getViewLinkMeta = ({ uri }: AgentToolView) => ({
  ui: { resourceUri: uri },
  [RESOURCE_URI_META_KEY]: uri,
  "openai/outputTemplate": uri,
});

/**
 * The view's sandbox policy. A view inlines its scripts, styles, and fonts
 * and reaches the server only through the host's `tools/call`, so it
 * declares no network origin. It opens only site pages, which ChatGPT
 * requires as redirect domains. `ui.domain` stays unset: Claude and ChatGPT
 * expect different formats, and the view needs no stable origin of its own.
 */
export const getViewResourceMeta = (siteOrigin: string) => ({
  ui: {
    csp: { connectDomains: [], resourceDomains: [] },
    prefersBorder: true,
  },
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: [],
    redirect_domains: [siteOrigin],
  },
  "openai/widgetPrefersBorder": true,
});

/** The distinct views the tools render in. */
export const getAgentToolViews = (
  tools: ReadonlyArray<{ readonly view?: AgentToolView }>
) => [
  ...new Map(
    tools.flatMap(({ view }) => (view ? [[view.uri, view] as const] : []))
  ).values(),
];
