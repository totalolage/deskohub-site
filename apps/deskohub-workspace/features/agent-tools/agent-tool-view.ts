import { RESOURCE_URI_META_KEY } from "@modelcontextprotocol/ext-apps/server";

import type { AgentToolClient } from "./agent-tool-client";

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
  /**
   * What hosts show while the linked tool runs and once it has answered,
   * at most 64 characters each.
   */
  readonly invocationStatus: {
    readonly invoking: string;
    readonly invoked: string;
  };
  readonly html: string;
}

/**
 * The tool `_meta` that links a tool to the view its result renders in:
 * the MCP Apps key, its deprecated flat form, and ChatGPT's alias, with
 * the status ChatGPT shows while the tool runs.
 */
export const getViewLinkMeta = ({ uri, invocationStatus }: AgentToolView) => ({
  ui: { resourceUri: uri },
  [RESOURCE_URI_META_KEY]: uri,
  "openai/outputTemplate": uri,
  "openai/toolInvocation/invoking": invocationStatus.invoking,
  "openai/toolInvocation/invoked": invocationStatus.invoked,
});

/**
 * The view's resource `_meta`: its sandbox policy and how ChatGPT presents
 * it. A view inlines its scripts, styles, and fonts and reaches the server
 * only through the host's `tools/call`, so it declares no network origin.
 * It opens only site pages, which ChatGPT requires as redirect domains.
 *
 * ChatGPT's directory requires a widget domain unique to the app, so the
 * view names the site origin. Claude accepts `ui.domain` only in its own
 * `{hash}.claudemcpcontent.com` form, and the view needs no stable origin
 * there, so only ChatGPT gets `ui.domain`; its `openai/widgetDomain` alias
 * reaches every client, and other hosts ignore it.
 */
export const getViewResourceMeta = ({
  view,
  siteOrigin,
  client,
}: {
  readonly view: AgentToolView;
  readonly siteOrigin: string;
  readonly client: AgentToolClient;
}) => ({
  ui: {
    csp: { connectDomains: [], resourceDomains: [] },
    prefersBorder: true,
    ...(client === "chatgpt" && { domain: siteOrigin }),
  },
  "openai/widgetDomain": siteOrigin,
  "openai/widgetDescription": view.description,
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
