import { Option, Schema } from "effect";
import type { McpRequest } from "./agent-tool-mcp-messages";

/**
 * The app an MCP request comes from, as far as it changes what the server
 * publishes. ChatGPT and the Claude apps (claude.ai, Claude Desktop, and
 * Claude mobile) list the server in their app directories, which review
 * every tool and its copy. Every other client, and one we can't recognize,
 * is `other`.
 */
export type AgentToolClient = "chatgpt" | "claude" | "other";

/**
 * The `clientInfo` names directory apps send: ChatGPT as `openai-mcp`, the
 * Claude apps as `Anthropic/ClaudeAI` (earlier `claude-ai`). Claude Code
 * sends `claude-code` and stays `other`.
 */
const clientInfoNames: ReadonlyMap<string, AgentToolClient> = new Map([
  ["openai-mcp", "chatgpt"],
  ["anthropic/claudeai", "claude"],
  ["claude-ai", "claude"],
]);

/**
 * User-Agent tokens of directory apps, for requests without `clientInfo`:
 * ChatGPT sends `openai-mcp/1.0.0`, and Anthropic's servers call for the
 * Claude apps as `Claude-User`.
 */
const userAgentTokens: ReadonlyArray<readonly [string, AgentToolClient]> = [
  ["openai-mcp", "chatgpt"],
  ["claude-user", "claude"],
];

const clientInfoSchema = Schema.Struct({ name: Schema.String });

const clientInfoMessageSchema = Schema.Struct({
  params: Schema.Union([
    // `initialize`, which carries it in every protocol revision
    Schema.Struct({ clientInfo: clientInfoSchema }),
    // any request of the 2026-07-28 revision, in its `_meta` envelope
    Schema.Struct({
      _meta: Schema.Struct({
        "io.modelcontextprotocol/clientInfo": clientInfoSchema,
      }),
    }),
  ]),
});

const decodeClientInfoMessage = Schema.decodeUnknownOption(
  clientInfoMessageSchema
);

const getClientInfoName = ({ params }: typeof clientInfoMessageSchema.Type) =>
  "clientInfo" in params
    ? params.clientInfo.name
    : params._meta["io.modelcontextprotocol/clientInfo"].name;

/**
 * Identifies the client of an MCP request. The server is stateless, so each
 * request is identified on its own: by the `clientInfo` a message carries,
 * which `initialize` and every 2026-07-28 request send, and otherwise by
 * the User-Agent, which 2025-era requests after `initialize` rely on.
 */
export const identifyAgentToolClient = ({
  request,
  messages,
}: McpRequest): AgentToolClient =>
  Option.match(
    Option.firstSomeOf(
      messages.map((message) =>
        Option.map(decodeClientInfoMessage(message), getClientInfoName)
      )
    ),
    {
      onSome: (name) => clientInfoNames.get(name.toLowerCase()) ?? "other",
      onNone: () => {
        const userAgent =
          request.headers.get("user-agent")?.toLowerCase() ?? "";
        return (
          userAgentTokens.find(([token]) => userAgent.includes(token))?.[1] ??
          "other"
        );
      },
    }
  );
