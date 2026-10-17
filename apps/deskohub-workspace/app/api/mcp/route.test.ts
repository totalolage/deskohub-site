import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  CallToolResult,
  InitializeResult,
  ListToolsResult,
} from "@modelcontextprotocol/client";
import type { Schema } from "effect";

let rateLimit: { rateLimited: boolean; error?: "not-found" | "blocked" } = {
  rateLimited: false,
};
const checkRateLimit = mock(async () => rateLimit);
mock.module("@vercel/firewall", () => ({ checkRateLimit }));

const { makeAgentToolTestServices, workspaceDateFromToday } = await import(
  "@/features/agent-tools/agent-tools.test-utils"
);
const services = makeAgentToolTestServices();
const { listOfferingsTool } = await import(
  "@/features/agent-tools/list-offerings.tool"
);
const { checkAvailabilityTool } = await import(
  "@/features/agent-tools/check-availability.tool"
);
const { getQuoteTool } = await import("@/features/agent-tools/get-quote.tool");
mock.module("@/features/agent-tools/customer-agent-tools", () => ({
  customerAgentTools: [listOfferingsTool, checkAvailabilityTool, getQuoteTool],
  CustomerAgentToolsLive: services.layer,
}));

const { Client } = await import("@modelcontextprotocol/client");
const { StreamableHTTPClientTransport } = await import(
  "@modelcontextprotocol/client"
);
const route = (await import("./route")) as Record<
  "DELETE" | "GET" | "POST",
  (request: Request) => Promise<Response>
>;

const endpoint = "http://deskohub.test/api/mcp";
const legacyProtocolVersion = "2025-11-25";

let requestId = 0;

/** One JSON-RPC exchange over the 2025-era stateless Streamable HTTP leg. */
const rpc = async <Result>(method: string, params: Schema.JsonObject = {}) => {
  const response = await route.POST(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": legacyProtocolVersion,
        "x-real-ip": "203.0.113.7",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method,
        params,
      }),
    })
  );

  expect(response.status).toBe(200);
  return (await readJsonRpc(response)) as {
    readonly result?: Result;
    readonly error?: { readonly code: number; readonly message: string };
  };
};

/** Reads a JSON body, or the last `data:` event of an SSE body. */
const readJsonRpc = async (response: Response) => {
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const events = body
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    return JSON.parse(events.at(-1) ?? "null");
  }
  return JSON.parse(body);
};

const callTool = (name: string, args: Schema.JsonObject) =>
  rpc<CallToolResult>("tools/call", { name, arguments: args });

describe("customer MCP route", () => {
  beforeEach(() => {
    rateLimit = { rateLimited: false };
    checkRateLimit.mockClear();
  });

  test("initializes as the DH Workspace server with booking instructions", async () => {
    const { result } = await rpc<InitializeResult>("initialize", {
      protocolVersion: legacyProtocolVersion,
      capabilities: {},
      clientInfo: { name: "route-test", version: "1.0.0" },
    });

    expect(result).toMatchObject({
      protocolVersion: legacyProtocolVersion,
      serverInfo: { name: "dh-workspace", version: "1.0.0" },
      capabilities: { tools: expect.any(Object) },
    });
    expect(result?.instructions).toContain("paid on the website");
  });

  test("lists the public read-only tools with schemas and annotations", async () => {
    const { result } = await rpc<ListToolsResult>("tools/list");
    const tools = result?.tools ?? [];

    expect(tools.map(({ name }) => name)).toEqual([
      "list_offerings",
      "check_availability",
      "get_quote",
    ]);
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        properties: { locale: { enum: ["en-US", "cs-CZ"] } },
      });
      expect(tool.outputSchema).toMatchObject({ type: "object" });
    }
    expect(tools[1]?.inputSchema).toMatchObject({
      properties: {
        family: { enum: ["cowork", "meeting-room", "office"] },
        date: {
          type: "string",
          description: expect.stringContaining("YYYY-MM-DD"),
        },
        seats: expect.objectContaining({ type: "integer" }),
        duration: { enum: ["hour:1", "hour:4", "day:1"] },
      },
      required: ["family", "date"],
    });
  });

  test("calls each tool and returns structured results", async () => {
    const date = workspaceDateFromToday(2);

    const offerings = await callTool("list_offerings", {});
    const availability = await callTool("check_availability", {
      family: "cowork",
      date,
      tier: "open-space",
    });
    const priced = await callTool("get_quote", {
      family: "cowork",
      date,
      tier: "open-space",
    });

    expect(offerings.result?.isError).toBeFalsy();
    expect(offerings.result?.structuredContent?.offerings).toHaveLength(6);
    expect(availability.result?.structuredContent).toMatchObject({
      family: "cowork",
      available: true,
      days: [{ date, available: true }],
    });
    expect(priced.result?.structuredContent).toMatchObject({
      total: { amount: 290, currency: "CZK" },
    });
    expect(priced.result?.content).toEqual([
      {
        type: "text",
        text: JSON.stringify(priced.result?.structuredContent),
      },
    ]);
    expect(checkRateLimit).toHaveBeenCalledTimes(3);
    expect(services.dotyposRequests).toEqual([]);
  });

  test("answers an invalid call with a typed error in the requested locale", async () => {
    const { result } = await callTool("get_quote", {
      family: "cowork",
      date: "tomorrow",
      locale: "cs-CZ",
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "invalid_input",
          field: "date",
          message: "Hodnota date chybí nebo je neplatná.",
        },
      },
      content: [{ text: "Hodnota date chybí nebo je neplatná." }],
    });
  });

  test("answers an unknown tool with a protocol error", async () => {
    const response = await callTool("cancel_reservation", {});

    expect(response.error ?? response.result?.isError).toBeTruthy();
  });

  test("rejects calls over the per-IP rate limit", async () => {
    rateLimit = { rateLimited: true };

    const { result } = await callTool("list_offerings", { locale: "en-US" });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "rate_limited" } },
    });
    expect(checkRateLimit).toHaveBeenCalledWith("agent-tool-call", {
      headers: expect.any(Headers),
    });
  });

  test("admits calls while the rate-limit rule is missing", async () => {
    rateLimit = { rateLimited: false, error: "not-found" };

    const { result } = await callTool("list_offerings", {});

    expect(result?.isError).toBeFalsy();
  });

  test("answers session requests with 405", async () => {
    const get = await route.GET(new Request(endpoint, { method: "GET" }));
    const remove = await route.DELETE(
      new Request(endpoint, { method: "DELETE" })
    );

    expect(get.status).toBe(405);
    expect(remove.status).toBe(405);
  });

  test("serves the SDK client end to end", async () => {
    const client = new Client({ name: "route-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: (input: string | URL | Request, init?: RequestInit) =>
          route.POST(new Request(input, init)),
      })
    );

    const { tools } = await client.listTools();
    const result = await client.callTool({
      name: "get_quote",
      arguments: {
        family: "meeting-room",
        date: workspaceDateFromToday(3),
        start_time: "10:00",
        duration: "hour:1",
      },
    });
    await client.close();

    expect(tools.map(({ name }) => name)).toContain("get_quote");
    expect(result.structuredContent).toMatchObject({
      total: { amount: 350, currency: "CZK" },
    });
  });
});
