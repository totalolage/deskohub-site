import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type {
  CallToolResult,
  InitializeResult,
  ListToolsResult,
} from "@modelcontextprotocol/client";
import { Effect, type Schema } from "effect";
import type { AgentTrafficEvent } from "@/shared/backend/agent-traffic/agent-traffic-events";

const agentTrafficEvents = await import(
  "@/shared/backend/agent-traffic/agent-traffic-events"
);

const scheduledEvents: AgentTrafficEvent[] = [];
mock.module("@/shared/backend/agent-traffic/agent-traffic-events", () => ({
  ...agentTrafficEvents,
  scheduleAgentTrafficEvent: (event: AgentTrafficEvent) =>
    Effect.sync(() => {
      scheduledEvents.push(event);
    }),
}));

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
const { AjvJsonSchemaValidator } = await import(
  "@modelcontextprotocol/client/validators/ajv"
);
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

/** A JSON-RPC request over the 2025-era stateless Streamable HTTP leg. */
const postRpc = (
  method: string,
  params: Schema.JsonObject = {},
  headers: Record<string, string> = {}
) =>
  route.POST(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": legacyProtocolVersion,
        "x-real-ip": "203.0.113.7",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++requestId,
        method,
        params,
      }),
    })
  );

/** One JSON-RPC exchange over the 2025-era stateless Streamable HTTP leg. */
const rpc = async <Result>(method: string, params: Schema.JsonObject = {}) => {
  const response = await postRpc(method, params);

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

/** An SDK client on the 2026 per-request leg, sending these extra headers. */
const connectClient = async (headers: Record<string, string> = {}) => {
  const client = new Client({ name: "route-test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint), {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        for (const [name, value] of Object.entries(headers)) {
          request.headers.set(name, value);
        }
        return route.POST(request);
      },
    })
  );
  return client;
};

const jsonSchemaValidator = new AjvJsonSchemaValidator();

/** Validates a tool result's structured content against its published schema. */
const validateStructuredContent = async (
  name: string,
  result: CallToolResult | undefined
) => {
  const { result: list } = await rpc<ListToolsResult>("tools/list");
  const outputSchema = list?.tools.find(
    (tool) => tool.name === name
  )?.outputSchema;

  expect(outputSchema).toBeDefined();
  return jsonSchemaValidator.getValidator(outputSchema!)(
    result?.structuredContent
  );
};

describe("customer MCP route", () => {
  beforeEach(() => {
    rateLimit = { rateLimited: false };
    checkRateLimit.mockClear();
    scheduledEvents.length = 0;
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
    for (const [name, response] of [
      ["list_offerings", offerings],
      ["check_availability", availability],
      ["get_quote", priced],
    ] as const) {
      expect(
        await validateStructuredContent(name, response.result)
      ).toMatchObject({ valid: true });
    }
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
    expect(await validateStructuredContent("get_quote", result)).toMatchObject({
      valid: true,
    });
  });

  test("publishes error results in every tool's output schema", async () => {
    const outOfRange = await callTool("check_availability", {
      family: "cowork",
      date: "2000-01-01",
    });
    rateLimit = { rateLimited: true };
    const limited = await callTool("list_offerings", {});

    expect(outOfRange.result?.structuredContent).toMatchObject({
      error: { code: "date_out_of_range" },
    });
    expect(
      await validateStructuredContent("check_availability", outOfRange.result)
    ).toMatchObject({ valid: true });
    expect(
      await validateStructuredContent("list_offerings", limited.result)
    ).toMatchObject({ valid: true });
    expect(
      await validateStructuredContent("list_offerings", {
        content: [],
        structuredContent: { error: { code: "rate_limited" } },
      })
    ).toMatchObject({ valid: false });
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

  test("fails closed while the rate-limit rule is missing", async () => {
    rateLimit = { rateLimited: false, error: "not-found" };

    const english = await callTool("list_offerings", {});
    const czech = await callTool("list_offerings", { locale: "cs-CZ" });

    expect(english.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "service_unavailable",
          message:
            "The tools are temporarily unavailable. Try again later or use the website.",
        },
      },
    });
    expect(czech.result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "service_unavailable",
          message:
            "Nástroje jsou dočasně nedostupné. Zkus to později nebo použij web.",
        },
      },
    });
    expect(
      await validateStructuredContent("list_offerings", english.result)
    ).toMatchObject({ valid: true });
    expect(services.dotyposRequests).toEqual([]);
  });

  test("fails closed when the firewall check rejects", async () => {
    checkRateLimit.mockImplementationOnce(async () => {
      throw new Error("firewall unreachable");
    });

    const { result } = await callTool("get_quote", {
      family: "cowork",
      date: workspaceDateFromToday(2),
      tier: "open-space",
    });

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "service_unavailable" } },
    });
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
    const client = await connectClient();

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

  describe("Origin", () => {
    const listTools = { protocolVersion: legacyProtocolVersion };

    test("serves 2025-era requests without an Origin or from the deployment", async () => {
      const withoutOrigin = await postRpc("tools/list", listTools);
      const sameOrigin = await postRpc("tools/list", listTools, {
        origin: "http://deskohub.test",
      });

      expect(withoutOrigin.status).toBe(200);
      expect(sameOrigin.status).toBe(200);
    });

    test("rejects 2025-era requests from another origin with 403", async () => {
      const foreign = await postRpc("tools/list", listTools, {
        origin: "https://evil.example",
      });
      const opaque = await postRpc("tools/list", listTools, {
        origin: "null",
      });

      expect(foreign.status).toBe(403);
      expect(opaque.status).toBe(403);
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    test("serves the 2026 leg from the deployment's origin", async () => {
      const client = await connectClient({ origin: "http://deskohub.test" });

      const { tools } = await client.listTools();
      await client.close();

      expect(tools.map(({ name }) => name)).toContain("list_offerings");
    });

    test("rejects the 2026 leg from another origin with 403", async () => {
      const connecting = connectClient({ origin: "https://evil.example" });

      expect(connecting).rejects.toThrow();
      await connecting.catch(() => undefined);
    });
  });

  test("counts a tool call by the agent category of the request's own headers", async () => {
    const response = await postRpc(
      "tools/call",
      { name: "list_offerings", arguments: {} },
      {
        "user-agent":
          "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)",
      }
    );
    await readJsonRpc(response);

    expect(scheduledEvents).toEqual([
      {
        event: "agent tool call",
        traffic: { category: "ai_user_agent", name: "claude" },
        properties: { tool: "list_offerings", outcome: "success" },
        timestamp: expect.any(Temporal.Instant),
      },
    ]);
  });
});
