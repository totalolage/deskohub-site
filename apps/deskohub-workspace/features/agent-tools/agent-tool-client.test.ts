import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { identifyAgentToolClient } from "./agent-tool-client";

const mcpRequest = ({
  body,
  userAgent,
}: {
  readonly body: unknown;
  readonly userAgent?: string;
}) =>
  new Request("https://workspace.example/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(userAgent && { "user-agent": userAgent }),
    },
    body: JSON.stringify(body),
  });

const initialize = (name: string) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name, version: "1.0.0" },
  },
});

const toolsList = (envelopeClient?: string) => ({
  jsonrpc: "2.0",
  id: 2,
  method: "tools/list",
  params: envelopeClient
    ? {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": {
            name: envelopeClient,
            version: "1.0.0",
          },
        },
      }
    : {},
});

const identify = (request: Request) =>
  Effect.runPromise(identifyAgentToolClient(request));

describe("identifyAgentToolClient", () => {
  test.each([
    ["openai-mcp", "chatgpt"],
    ["Anthropic/ClaudeAI", "claude"],
    ["claude-ai", "claude"],
    ["claude-code", "other"],
    ["Visual Studio Code", "other"],
  ] as const)(
    "names a client that initializes as %s %s",
    async (name, client) => {
      expect(await identify(mcpRequest({ body: initialize(name) }))).toBe(
        client
      );
    }
  );

  test("reads the clientInfo of a 2026-07-28 request's envelope", async () => {
    expect(await identify(mcpRequest({ body: toolsList("openai-mcp") }))).toBe(
      "chatgpt"
    );
  });

  test("trusts clientInfo over the User-Agent, so Claude Code through Anthropic's gateway keeps every tool", async () => {
    expect(
      await identify(
        mcpRequest({ body: toolsList("claude-code"), userAgent: "Claude-User" })
      )
    ).toBe("other");
  });

  test.each([
    ["openai-mcp/1.0.0", "chatgpt"],
    ["openai-mcp/1.0.0 (ChatGPT)", "chatgpt"],
    ["Claude-User", "claude"],
    ["claude-code/2.1.0 (cli)", "other"],
    ["Mozilla/5.0", "other"],
  ] as const)(
    "names a 2025-era request without clientInfo from User-Agent %s as %s",
    async (userAgent, client) => {
      expect(await identify(mcpRequest({ body: toolsList(), userAgent }))).toBe(
        client
      );
    }
  );

  test("serves a request it can't recognize as other", async () => {
    expect(
      await identify(
        new Request("https://workspace.example/api/mcp", {
          method: "POST",
          body: "not json",
        })
      )
    ).toBe("other");
  });
});
