import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  CallToolResult,
  InitializeResult,
  ListToolsResult,
  Resource,
} from "@modelcontextprotocol/client";
import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { AgentToolClient } from "@/features/agent-tools/agent-tool-client";
import { m } from "@/features/i18n";
import type { AgentTrafficEvent } from "@/shared/backend/agent-traffic/agent-traffic-events";
import type { RequestBudgetPolicy } from "@/shared/backend/request-budget/request-budget.service";

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

const mcpResource = "http://deskohub.test/api/mcp";
const resourceMetadata =
  "http://deskohub.test/.well-known/oauth-protected-resource/api/mcp";
const agentAccountId = "agent-test-account";
const agentClientId = "https://agent.example/oauth-client.json";

/** Access tokens the fake authorization server knows, with their scopes. */
const accessTokens = new Map<string, string>();
let authorizationServerReachable = true;
mock.module("@/features/account/server/auth.server", () => ({
  customerMcpResource: mcpResource,
  auth: {
    api: {
      verifyCustomerAgentAccessToken: async ({
        body,
      }: {
        readonly body: { readonly token: string };
      }) => {
        if (!authorizationServerReachable) {
          throw new Error("Authorization server is unreachable");
        }
        const scope = accessTokens.get(body.token);
        if (scope === undefined) {
          throw Object.assign(new Error("Unknown token"), { name: "APIError" });
        }
        return {
          active: true,
          sub: agentAccountId,
          client_id: agentClientId,
          scope,
          aud: mcpResource,
        };
      },
    },
    $context: Promise.resolve({
      internalAdapter: {
        findUserById: async (id: string) => ({
          id,
          email: testEmailAddress("mcp-agent"),
          emailVerified: true,
          name: "Agent Customer",
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      },
    }),
  },
}));

// Signed-in calls build their account services, which never query here.
mock.module("@/db/database-provider.server", () => ({
  workspaceDatabaseLayer: Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make({} as never)
  ),
  workspaceDatabasePool: { options: { max: 4 } },
}));

const requestBudget = await import(
  "@/shared/backend/request-budget/request-budget.service"
);
const budgetSpends: RequestBudgetPolicy[] = [];
let exhaustedBudget: ((key: string) => boolean) | undefined;
class TestRequestBudget extends requestBudget.RequestBudget {
  static override Live = Layer.succeed(requestBudget.RequestBudget, {
    spend: (policy) =>
      Effect.sync(() => {
        budgetSpends.push(policy);
        return exhaustedBudget?.(policy.key)
          ? requestBudget.RequestBudgetSpend.Exhausted({
              retryAt: DateTime.nowUnsafe(),
            })
          : requestBudget.RequestBudgetSpend.Granted();
      }),
  });
}
mock.module("@/shared/backend/request-budget/request-budget.service", () => ({
  ...requestBudget,
  RequestBudget: TestRequestBudget,
}));

/**
 * Whether the fake administrator check finds the token's account holding
 * the administrator grant, without it, or can't tell.
 */
let administratorGrant: "live" | "revoked" | "unavailable" = "live";
let administratorAuthorizationCalls = 0;
const administratorAuthorization = await import(
  "@/features/administrators/backend/administrator-agent-authorization.service"
);
class TestAdministratorAgentAuthorization extends administratorAuthorization.AdministratorAgentAuthorization {
  static override Live = Layer.succeed(
    administratorAuthorization.AdministratorAgentAuthorization,
    {
      authorize: () => {
        administratorAuthorizationCalls += 1;
        return administratorGrant === "live"
          ? Effect.succeed({
              accountId: agentAccountId,
              email: testEmailAddress("mcp-administrator"),
            } as never)
          : Effect.fail({
              _tag: "AdministratorAgentAuthorizationError",
              reason:
                administratorGrant === "revoked"
                  ? "not-administrator"
                  : "unavailable",
            } as never);
      },
    }
  );
}
mock.module(
  "@/features/administrators/backend/administrator-agent-authorization.service",
  () => ({
    ...administratorAuthorization,
    AdministratorAgentAuthorization: TestAdministratorAgentAuthorization,
  })
);

/** What the administration API built for agents answers. */
let administrationResponse = () => Response.json([]);

/** The requests the administration API built for agents received. */
const administrationRequests: Array<{
  readonly method: string;
  readonly path: string;
  readonly authorization: string | null;
}> = [];
mock.module(
  "@/features/administration-agent-tools/administration-assistant-api.server",
  () => ({
    handleAssistantAdministrationRequest: async (request: Request) => {
      administrationRequests.push({
        method: request.method,
        path: new URL(request.url).pathname,
        authorization: request.headers.get("authorization"),
      });
      return administrationResponse();
    },
  })
);

const { makeAgentToolTestServices, workspaceDateFromToday } = await import(
  "@/features/agent-tools/agent-tools.test-utils"
);
const services = makeAgentToolTestServices();
const preparePayStateModule = await import(
  "@/features/reservation/actions/prepare-pay-state"
);
/** Every booking the route started, so a test can assert it booked nothing. */
const bookingCalls: unknown[] = [];
mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  ...preparePayStateModule,
  prepareWorkspacePayState: (
    input: Parameters<typeof preparePayStateModule.prepareWorkspacePayState>[0]
  ) =>
    Effect.sync(() => bookingCalls.push(input)).pipe(
      Effect.andThen(preparePayStateModule.prepareWorkspacePayState(input))
    ),
}));

const { agentToolLocaleField, defineSignedInAgentTool } = await import(
  "@/features/agent-tools/agent-tool"
);
const { CurrentCustomerAgentGrant } = await import(
  "@/features/agent-tools/customer-agent-caller"
);

/** A signed-in tool that answers with the grant it runs for. */
const whoamiTool = defineSignedInAgentTool({
  name: "whoami",
  title: "Who am I",
  description: "Answers with the grant of the calling agent.",
  scope: "reservations:read",
  readOnly: true,
  unavailableCode: "reservations_unavailable",
  input: Schema.Struct({ locale: agentToolLocaleField }),
  output: Schema.Struct({
    account_id: Schema.String,
    client_id: Schema.String,
    scopes: Schema.Array(Schema.String),
  }),
  run: () =>
    CurrentCustomerAgentGrant.pipe(
      Effect.map((grant) => ({
        account_id: grant.accountId,
        client_id: grant.clientId,
        scopes: [...grant.scopes],
      }))
    ),
});

// Every client is served the catalog's customer tools and `whoami` after
// them, reading the test services.
const { customerAgentCatalog } = await import(
  "@/features/agent-tools/customer-agent-catalog"
);
mock.module("@/features/agent-tools/customer-agent-catalog", () => ({
  customerAgentCatalog: {
    ...customerAgentCatalog,
    forClient: (client: AgentToolClient) => {
      const served = customerAgentCatalog.forClient(client);
      return { ...served, tools: [...served.tools, whoamiTool] };
    },
  },
}));
mock.module("@/features/agent-tools/customer-agent-tools", () => ({
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

const legacyProtocolVersion = "2025-11-25";

let requestId = 0;

/** A JSON-RPC request over the 2025-era stateless Streamable HTTP leg. */
const postRpc = (
  method: string,
  params: Schema.JsonObject = {},
  headers: Record<string, string> = {}
) =>
  route.POST(
    new Request(mcpResource, {
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

/**
 * An SDK client on the 2026 per-request leg, named `name` in its
 * `clientInfo` and sending these extra headers.
 */
const connectClient = async (
  headers: Record<string, string> = {},
  name = "route-test"
) => {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(mcpResource), {
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
    budgetSpends.length = 0;
    exhaustedBudget = undefined;
    authorizationServerReachable = true;
    accessTokens.clear();
  });

  test("initializes as the Deskohub Workspace server with the catalog's instructions for the client", async () => {
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
    expect(result?.instructions).toBe(
      customerAgentCatalog.forClient("other").instructions
    );
  });

  test("publishes each tool's access, so the site registers only the public read tools", async () => {
    const { isSiteTool, listAgentTools } = await import(
      "@/features/agent-tools/webmcp/agent-tool-mcp-client"
    );
    const originalFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      (input: string | URL | Request, init?: RequestInit) =>
        route.POST(new Request(new URL(String(input), mcpResource), init)),
      { preconnect: originalFetch.preconnect }
    );
    try {
      const tools = await Effect.runPromise(listAgentTools);

      expect(tools.filter(isSiteTool).map(({ name }) => name)).toEqual([
        "list_offerings",
        "check_availability",
        "get_quote",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("lists the public and signed-in tools with schemas and annotations", async () => {
    const { result } = await rpc<ListToolsResult>("tools/list");
    const tools = result?.tools ?? [];

    expect(tools.map(({ name }) => name)).toEqual([
      "list_offerings",
      "check_availability",
      "get_quote",
      "show_booking",
      "start_reservation",
      "get_reservation_status",
      "list_my_reservations",
      "whoami",
    ]);
    expect(
      Object.fromEntries(
        tools.map(({ name, _meta }) => [
          name,
          _meta?.["cz.deskohub.workspace/access"],
        ])
      )
    ).toEqual({
      list_offerings: "public",
      check_availability: "public",
      get_quote: "public",
      show_booking: "public",
      start_reservation: "signed-in",
      get_reservation_status: "signed-in",
      list_my_reservations: "signed-in",
      whoami: "signed-in",
    });
    // A different selection cancels the earlier unpaid hold; the same one
    // returns the same order.
    expect(
      tools.find(({ name }) => name === "start_reservation")?.annotations
    ).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    for (const tool of tools) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: tool.name !== "start_reservation",
        destructiveHint: tool.name === "start_reservation",
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

  test("links a later office quote on its quoted start date", async () => {
    const startsOn = workspaceDateFromToday(3);
    const { result } = await callTool("get_quote", {
      family: "office",
      date: startsOn,
      end_date: workspaceDateFromToday(4),
      seats: 2,
      locale: "cs-CZ",
    });

    expect(result?.structuredContent?.reservation_url).toEndWith(
      `/reservation/office?startsOn=${startsOn}&dayCount=2&seats=2`
    );
    expect(await validateStructuredContent("get_quote", result)).toMatchObject({
      valid: true,
    });
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
    const get = await route.GET(new Request(mcpResource, { method: "GET" }));
    const remove = await route.DELETE(
      new Request(mcpResource, { method: "DELETE" })
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

describe("customer MCP route for signed-in tools", () => {
  beforeEach(() => {
    rateLimit = { rateLimited: false };
    checkRateLimit.mockClear();
    budgetSpends.length = 0;
    exhaustedBudget = undefined;
    authorizationServerReachable = true;
    accessTokens.clear();
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const callToolAs = (
    name: string,
    args: Schema.JsonObject,
    headers: Record<string, string>
  ) => postRpc("tools/call", { name, arguments: args }, headers);

  test("answers a signed-in tool call without a token with a 401 challenge", async () => {
    const response = await callToolAs(
      "start_reservation",
      { family: "cowork", date: workspaceDateFromToday(2), tier: "open-space" },
      {}
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${resourceMetadata}", scope="reservations:create"`
    );
    expect(checkRateLimit).not.toHaveBeenCalled();
    // ChatGPT offers signing in for one tool from the challenge in an error
    // result's `_meta`, which also needs an error and its description.
    const { id, result } = await response.json();
    expect(id).toBe(requestId);
    expect(result.isError).toBe(true);
    const [challenge] = result._meta["mcp/www_authenticate"];
    expect(challenge).toStartWith(
      `Bearer resource_metadata="${resourceMetadata}", scope="reservations:create"`
    );
    expect(challenge).toContain('error="');
    expect(challenge).toContain('error_description="');
  });

  test("answers a request with an unknown token with an invalid_token challenge", async () => {
    const response = await postRpc("tools/list", {}, bearer("unknown-token"));

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${resourceMetadata}", error="invalid_token"`
    );
    expect(await response.text()).toBe("");
  });

  test("answers a token without the tool's scope with a 403 insufficient_scope challenge", async () => {
    accessTokens.set("create-only", "reservations:create");

    const response = await callToolAs("whoami", {}, bearer("create-only"));

    expect(response.status).toBe(403);
    const challenge = response.headers.get("www-authenticate");
    expect(challenge).toStartWith('Bearer error="insufficient_scope"');
    expect(challenge).toContain('scope="reservations:read"');
    expect(challenge).toContain(`resource_metadata="${resourceMetadata}"`);
  });

  test("checks each tool's own scope", async () => {
    accessTokens.set("read-only", "reservations:read");

    const start = await callToolAs(
      "start_reservation",
      { family: "cowork", date: workspaceDateFromToday(2), tier: "open-space" },
      bearer("read-only")
    );
    const status = await callToolAs(
      "get_reservation_status",
      { order_id: "missing" },
      {}
    );
    const list = await callToolAs("list_my_reservations", {}, {});

    expect(start.status).toBe(403);
    expect(start.headers.get("www-authenticate")).toContain(
      'scope="reservations:create"'
    );
    expect(status.status).toBe(401);
    expect(status.headers.get("www-authenticate")).toContain(
      'scope="reservations:read"'
    );
    expect(list.status).toBe(401);
  });

  test("runs a signed-in tool for the grant behind a valid token", async () => {
    accessTokens.set("valid", "reservations:read reservations:create");

    const response = await callToolAs("whoami", {}, bearer("valid"));

    expect(response.status).toBe(200);
    const { result } = (await readJsonRpc(response)) as {
      readonly result?: CallToolResult;
    };
    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toEqual({
      account_id: agentAccountId,
      client_id: agentClientId,
      scopes: ["reservations:read", "reservations:create"],
    });
    expect(budgetSpends.map(({ key }) => key.split(":").slice(0, 2))).toEqual([
      ["agent-tool", "grant"],
      ["agent-tool", "account"],
    ]);
    expect(
      budgetSpends.every(
        ({ key }) =>
          !key.includes(agentAccountId) && !key.includes(agentClientId)
      )
    ).toBe(true);
    expect(checkRateLimit).toHaveBeenCalledTimes(1);
  });

  test("spends a tool's own account budget on top of the signed-in budgets", async () => {
    accessTokens.set("valid", "reservations:create");
    exhaustedBudget = (key) => key.startsWith("agent-tool:start_reservation:");

    const response = await callToolAs(
      "start_reservation",
      { family: "cowork", date: workspaceDateFromToday(2), tier: "open-space" },
      bearer("valid")
    );
    const { result } = (await readJsonRpc(response)) as {
      readonly result?: CallToolResult;
    };

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "rate_limited" } },
    });
    expect(
      budgetSpends.map(({ key, limit }) => [key.split(":")[1], limit])
    ).toEqual([
      ["grant", 10],
      ["account", 20],
      ["start_reservation", 5],
    ]);
  });

  test("refuses a signed-in call over the account budget as rate limited", async () => {
    accessTokens.set("valid", "reservations:read");
    exhaustedBudget = (key) => key.startsWith("agent-tool:account:");

    const response = await callToolAs("whoami", {}, bearer("valid"));
    const { result } = (await readJsonRpc(response)) as {
      readonly result?: CallToolResult;
    };

    expect(result).toMatchObject({
      isError: true,
      structuredContent: { error: { code: "rate_limited" } },
    });
  });

  test("serves public tools to an agent with a valid token without spending its budgets", async () => {
    accessTokens.set("valid", "reservations:read");

    const response = await callToolAs("list_offerings", {}, bearer("valid"));
    const { result } = (await readJsonRpc(response)) as {
      readonly result?: CallToolResult;
    };

    expect(result?.isError).toBeFalsy();
    expect(budgetSpends).toEqual([]);
  });

  test("fails the request while the authorization server is unreachable", async () => {
    accessTokens.set("valid", "reservations:read");
    authorizationServerReachable = false;

    const response = await callToolAs("whoami", {}, bearer("valid"));

    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});

const toolChallengesSchema = Schema.Struct({
  result: Schema.Struct({
    _meta: Schema.Struct({
      "mcp/www_authenticate": Schema.Array(Schema.String),
    }),
  }),
});

describe("customer MCP route for administration tools", () => {
  beforeEach(() => {
    rateLimit = { rateLimited: false };
    checkRateLimit.mockClear();
    budgetSpends.length = 0;
    authorizationServerReachable = true;
    accessTokens.clear();
    administratorGrant = "live";
    administratorAuthorizationCalls = 0;
    administrationRequests.length = 0;
    administrationResponse = () => Response.json([]);
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  const listToolNames = async (headers: Record<string, string>) => {
    const response = await postRpc("tools/list", {}, headers);

    expect(response.status).toBe(200);
    const { result } = (await readJsonRpc(response)) as {
      readonly result: ListToolsResult;
    };
    return result.tools.map(({ name }) => name);
  };

  const administrationToolNames = (names: ReadonlyArray<string>) =>
    names.filter((name) => name.startsWith("admin_"));

  const callToolAs = async (
    name: string,
    args: Schema.JsonObject,
    headers: Record<string, string>
  ) => {
    const response = await postRpc(
      "tools/call",
      { name, arguments: args },
      headers
    );
    expect(response.status).toBe(200);
    return (await readJsonRpc(response)) as {
      readonly result?: CallToolResult;
      readonly error?: { readonly code: number; readonly message: string };
    };
  };

  test("lists no administration tools to an agent without a token", async () => {
    expect(administrationToolNames(await listToolNames({}))).toEqual([]);
  });

  test("lists no administration tools to a customer's agent", async () => {
    accessTokens.set("customer", "reservations:read reservations:create");

    expect(
      administrationToolNames(await listToolNames(bearer("customer")))
    ).toEqual([]);
  });

  test("lists no administration tools once the administrator grant is gone", async () => {
    accessTokens.set("administrator", "reservations:read administration");
    administratorGrant = "revoked";

    expect(
      administrationToolNames(await listToolNames(bearer("administrator")))
    ).toEqual([]);
  });

  test("lists the administration tools after the customer tools to an administrator's agent", async () => {
    accessTokens.set("administrator", "reservations:read administration");

    const names = await listToolNames(bearer("administrator"));
    const firstAdministrationTool = names.findIndex((name) =>
      name.startsWith("admin_")
    );

    expect(firstAdministrationTool).toBeGreaterThan(0);
    expect(
      names
        .slice(firstAdministrationTool)
        .every((name) => name.startsWith("admin_"))
    ).toBe(true);
    expect(names).toContain("admin_list_sessions");
    expect(names).toContain("admin_revoke_session");
  });

  test("publishes the administration access and the contract's annotations", async () => {
    accessTokens.set("administrator", "administration");

    const response = await postRpc("tools/list", {}, bearer("administrator"));
    const { result } = (await readJsonRpc(response)) as {
      readonly result: ListToolsResult;
    };
    const revoke = result.tools.find(
      ({ name }) => name === "admin_revoke_session"
    );

    expect(revoke?._meta?.["cz.deskohub.workspace/access"]).toBe(
      "administration"
    );
    expect(revoke?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });
    expect(revoke?.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
  });

  test("answers 503 and lists nothing while the administrator grant can't be checked", async () => {
    accessTokens.set("administrator", "administration");
    administratorGrant = "unavailable";

    const response = await postRpc("tools/list", {}, bearer("administrator"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("checks the grant without calling the administration for a customer's token", async () => {
    accessTokens.set("customer", "reservations:read");
    administratorGrant = "unavailable";

    const response = await postRpc("tools/list", {}, bearer("customer"));

    expect(response.status).toBe(200);
  });

  test.each([
    ["without a token", undefined],
    ["with a customer's token", "customer"],
    ["after the administrator grant is gone", "administrator"],
  ])("treats an administration tool called %s as unknown", async (_, token) => {
    accessTokens.set("customer", "reservations:read");
    accessTokens.set("administrator", "administration");
    administratorGrant = "revoked";

    const response = await callToolAs(
      "admin_list_sessions",
      {},
      token === undefined ? {} : bearer(token)
    );

    expect(response.error ?? response.result?.isError).toBeTruthy();
    expect(administrationRequests).toEqual([]);
  });

  test("treats administration tools in a batch as unknown once the grant is gone", async () => {
    accessTokens.set("administrator", "administration");
    administratorGrant = "revoked";

    const response = await route.POST(
      new Request(mcpResource, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-protocol-version": legacyProtocolVersion,
          "x-real-ip": "203.0.113.7",
          ...bearer("administrator"),
        },
        body: JSON.stringify(
          ["admin_list_sessions", "admin_revoke_session"].map((name) => ({
            jsonrpc: "2.0",
            id: ++requestId,
            method: "tools/call",
            params: {
              name,
              arguments: { sessionId: "0190a5c4-0000-7000-8000-000000000001" },
            },
          }))
        ),
      })
    );

    expect(response.status).toBeLessThan(500);
    expect(administrationRequests).toEqual([]);
  });

  /**
   * Every OAuth challenge a response carries: its `WWW-Authenticate` header
   * and each tool result's `_meta["mcp/www_authenticate"]`.
   */
  const challengesOf = async (response: Response) => {
    const body = await response.clone().text();
    const messages =
      body === ""
        ? []
        : [(await readJsonRpc(response.clone())) as Schema.Json].flat();
    return [
      response.headers.get("www-authenticate") ?? "",
      ...messages.flatMap((message) =>
        Schema.decodeUnknownOption(toolChallengesSchema)(message).pipe(
          Option.match({
            onNone: () => [],
            onSome: ({ result }) => result._meta["mcp/www_authenticate"],
          })
        )
      ),
    ];
  };

  test.each([
    ["an agent without a token", undefined, "live"],
    ["a customer's agent", "customer", "live"],
    [
      "an administrator's agent whose grant is gone",
      "administrator",
      "revoked",
    ],
    ["an administrator's agent", "administrator", "live"],
  ] as const)(
    "never challenges %s for the administration scope",
    async (_, token, grant) => {
      accessTokens.set("customer", "reservations:read");
      accessTokens.set("administrator", "reservations:read administration");
      administratorGrant = grant;
      const headers = token === undefined ? {} : bearer(token);
      const responses = [
        await postRpc("tools/list", {}, headers),
        ...(await Promise.all(
          [
            ["admin_list_sessions", {}],
            [
              "admin_revoke_session",
              { sessionId: "0190a5c4-0000-7000-8000-000000000001" },
            ],
            ["whoami", {}],
            ["start_reservation", {}],
          ].map(([name, args]) =>
            postRpc("tools/call", { name, arguments: args }, headers)
          )
        )),
      ];

      for (const response of responses) {
        for (const challenge of await challengesOf(response)) {
          expect(challenge).not.toContain("administration");
        }
      }
    }
  );

  test("keeps a customer tool's challenge naming only that tool's scope for an administrator's agent", async () => {
    accessTokens.set("administrator", "administration");

    const response = await postRpc(
      "tools/call",
      { name: "whoami", arguments: {} },
      bearer("administrator")
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="reservations:read"'
    );
    expect(response.headers.get("www-authenticate")).not.toContain(
      "administration"
    );
  });

  test("answers a refusal inside an administration call as a tool error, not a challenge", async () => {
    accessTokens.set("administrator", "administration");
    administrationResponse = () =>
      Response.json(
        {
          _tag: "CliSessionUnauthorized",
          message: "Administrator access for this assistant ended.",
        },
        { status: 401 }
      );

    const response = await postRpc(
      "tools/call",
      { name: "admin_list_sessions", arguments: {} },
      bearer("administrator")
    );
    const { result } = (await readJsonRpc(response.clone())) as {
      readonly result?: CallToolResult;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("www-authenticate")).toBeNull();
    expect(result?.isError).toBe(true);
    expect(result?.structuredContent).toMatchObject({
      error: {
        code: "administration_failed",
        error: { _tag: "CliSessionUnauthorized" },
      },
    });
  });

  test("runs an administration tool for an administrator's agent with its own token", async () => {
    accessTokens.set("administrator", "administration");

    const { result } = await callToolAs(
      "admin_list_sessions",
      {},
      bearer("administrator")
    );

    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toEqual({ items: [] });
    expect(administrationRequests).toEqual([
      {
        method: "GET",
        path: "/api/v1/cli/sessions",
        authorization: "Bearer administrator",
      },
    ]);
    expect(budgetSpends).toEqual([]);
  });

  test("answers a destructive call without confirm with a preview and changes nothing", async () => {
    accessTokens.set("administrator", "administration");

    const { result } = await callToolAs(
      "admin_revoke_session",
      { sessionId: "0190a5c4-0000-7000-8000-000000000001" },
      bearer("administrator")
    );

    expect(result?.isError).toBeFalsy();
    expect(result?.structuredContent).toMatchObject({
      outcome: "confirmation-required",
      operation: "admin_revoke_session",
      current: { "administration.listSessions": { items: [] } },
    });
    expect(administrationRequests.map(({ method }) => method)).toEqual(["GET"]);
  });

  test("refuses a call whose grant ended after the tools were listed, even one that reads nothing", async () => {
    accessTokens.set("administrator", "administration");
    // The grant ends after the request lists the caller's tools, before the
    // call runs.
    checkRateLimit.mockImplementationOnce(async () => {
      administratorGrant = "revoked";
      return { rateLimited: false };
    });

    const { result } = await callToolAs(
      "admin_create_standalone_access_code",
      {
        attemptId: "01980000-0000-7000-8000-000000000042",
        input: {
          name: "Synthetic Booth",
          startsAt: "2026-09-10T10:00",
          endsAt: "2026-09-10T12:00",
        },
      },
      bearer("administrator")
    );

    expect(result?.isError).toBe(true);
    expect(result?.structuredContent).toMatchObject({
      error: {
        code: "administration_failed",
        error: { _tag: "CliSessionUnauthorized" },
      },
    });
    expect(administratorAuthorizationCalls).toBe(2);
    expect(administrationRequests).toEqual([]);
  });
});

describe("customer MCP route booking view", () => {
  const bookingViewUri = "ui://dh-workspace/booking-v2.html";
  const viewMimeType = "text/html;profile=mcp-app";

  beforeEach(() => {
    rateLimit = { rateLimited: false };
    authorizationServerReachable = true;
    accessTokens.clear();
  });

  test("links only show_booking to the booking view", async () => {
    const { result } = await rpc<ListToolsResult>("tools/list");

    const linked = (result?.tools ?? []).filter(
      ({ _meta }) => _meta?.ui !== undefined
    );
    expect(linked.map(({ name, _meta }) => ({ name, _meta }))).toEqual([
      {
        name: "show_booking",
        _meta: {
          "cz.deskohub.workspace/access": "public",
          securitySchemes: [{ type: "noauth" }],
          ui: { resourceUri: bookingViewUri },
          "ui/resourceUri": bookingViewUri,
          "openai/outputTemplate": bookingViewUri,
          "openai/toolInvocation/invoking": expect.any(String),
          "openai/toolInvocation/invoked": expect.any(String),
        },
      },
    ]);
  });

  test("lists the booking view as an MCP Apps resource", async () => {
    const client = await connectClient();
    try {
      const { resources } = await client.listResources();

      expect(resources).toEqual([
        expect.objectContaining({
          uri: bookingViewUri,
          mimeType: viewMimeType,
          _meta: expect.objectContaining({
            ui: expect.objectContaining({ prefersBorder: true }),
          }),
        }),
      ]);
    } finally {
      await client.close();
    }
  });

  test("serves one self-contained document that declares no network origin", async () => {
    const client = await connectClient();
    try {
      const { contents } = await client.readResource({ uri: bookingViewUri });
      const [view] = contents;

      expect(contents).toHaveLength(1);
      expect(view).toMatchObject({
        uri: bookingViewUri,
        mimeType: viewMimeType,
        _meta: {
          ui: {
            csp: { connectDomains: [], resourceDomains: [] },
            prefersBorder: true,
          },
          "openai/widgetCSP": {
            connect_domains: [],
            resource_domains: [],
            redirect_domains: ["http://deskohub.test"],
          },
          "openai/widgetDomain": "http://deskohub.test",
          "openai/widgetDescription": expect.any(String),
        },
      });
      // Claude accepts only its own `ui.domain` form, so other clients get none.
      expect(view?._meta?.ui).not.toHaveProperty("domain");
      const html = view && "text" in view ? view.text : "";
      // Compared as booleans: a failure would print the whole document.
      expect(/^<!doctype html>/i.test(html)).toBe(true);
      // Scripts and styles are inline: nothing loads from an origin.
      expect(/<(?:script|link|img)[^>]+(?:src|href)=/i.test(html)).toBe(false);
      // The copy of both locales is compiled in.
      expect(
        [
          m.bookingWidgetCheck({}, { locale: "en-US" }),
          m.bookingWidgetCheck({}, { locale: "cs-CZ" }),
        ].map((copy) => html.includes(copy))
      ).toEqual([true, true]);
    } finally {
      await client.close();
    }
  });

  test("reads the booking view without a token", async () => {
    const { result } = await rpc<{
      readonly contents: ReadonlyArray<{ readonly mimeType: string }>;
    }>("resources/read", { uri: bookingViewUri });

    expect(result?.contents[0]?.mimeType).toBe(viewMimeType);
  });

  const showBookingAs = async (headers: Record<string, string>) => {
    const response = await postRpc(
      "tools/call",
      { name: "show_booking", arguments: { family: "office", seats: 2 } },
      headers
    );
    expect(response.status).toBe(200);
    const { result } = (await readJsonRpc(response)) as {
      readonly result?: CallToolResult;
    };
    expect(await validateStructuredContent("show_booking", result)).toEqual({
      valid: true,
      data: result?.structuredContent,
      errorMessage: undefined,
    });
    return result;
  };

  test("hands an agent without a token off to the reservation page, with the offerings as text", async () => {
    const result = await showBookingAs({});

    expect(result?.structuredContent).toMatchObject({
      booking_mode: "reservation_page",
      locale: "en-US",
      selection: { family: "office", seats: 2 },
      offerings: expect.arrayContaining([
        expect.objectContaining({ family: "cowork" }),
      ]),
    });
    // Hosts without MCP Apps get the whole result as text.
    const [text] = result?.content ?? [];
    expect(text?.type).toBe("text");
    expect(JSON.parse(text && "text" in text ? text.text : "null")).toEqual(
      result?.structuredContent
    );
  });

  test("lets an agent whose token grants reservations:create reserve in the view", async () => {
    accessTokens.set("create", "reservations:create");

    const result = await showBookingAs({ authorization: "Bearer create" });

    expect(result?.structuredContent).toMatchObject({
      booking_mode: "reserve",
    });
  });

  test("hands off an agent whose token only reads reservations", async () => {
    accessTokens.set("read", "reservations:read");

    const result = await showBookingAs({ authorization: "Bearer read" });

    expect(result?.structuredContent).toMatchObject({
      booking_mode: "reservation_page",
    });
  });
});

describe("customer MCP route per client", () => {
  const publicTools = [
    "list_offerings",
    "check_availability",
    "get_quote",
    "show_booking",
  ];
  const chatGpt = { "user-agent": "openai-mcp/1.0.0" };
  const claudeApp = { "user-agent": "Claude-User" };

  beforeEach(() => {
    rateLimit = { rateLimited: false };
    authorizationServerReachable = true;
    accessTokens.clear();
  });

  const listToolsAs = async (headers: Record<string, string>) => {
    const response = await postRpc("tools/list", {}, headers);
    expect(response.status).toBe(200);
    const { result } = (await readJsonRpc(response)) as {
      readonly result: ListToolsResult;
    };
    return result.tools;
  };

  /**
   * What a directory reviewer reads: the instructions, the tools as listed,
   * and the view's copy.
   */
  const readListingCopy = async (
    headers: Record<string, string>,
    clientName: string
  ) => {
    const initialize = await readJsonRpc(
      await postRpc(
        "initialize",
        {
          protocolVersion: legacyProtocolVersion,
          capabilities: {},
          clientInfo: { name: clientName, version: "1.0.0" },
        },
        headers
      )
    );
    const resources = await readJsonRpc(
      await postRpc("resources/list", {}, headers)
    );
    const tools = await listToolsAs(headers);
    return [
      initialize.result.instructions,
      ...tools.flatMap(({ title, description, inputSchema }) => [
        title,
        description,
        JSON.stringify(inputSchema),
      ]),
      ...resources.result.resources.flatMap(
        ({ title, description, _meta }: Resource) => [
          title,
          description,
          _meta?.["openai/widgetDescription"],
        ]
      ),
      // A signed-in tool's result reports the customer's own orders,
      // their payment state included, which isn't commerce copy.
      JSON.stringify(
        tools.map(({ outputSchema, ...tool }) =>
          tool._meta?.["cz.deskohub.workspace/access"] === "public"
            ? { ...tool, outputSchema }
            : tool
        )
      ),
    ].join("\n");
  };

  const customerTools = [
    ...publicTools,
    "start_reservation",
    "get_reservation_status",
    "list_my_reservations",
  ];

  test.each([
    ["ChatGPT", chatGpt],
    ["the Claude apps", claudeApp],
  ])("lists every tool to %s", async (_, headers) => {
    const tools = await listToolsAs(headers);

    expect(tools.map(({ name }) => name)).toEqual([...customerTools, "whoami"]);
    for (const tool of tools.filter(({ name }) =>
      customerTools.includes(name)
    )) {
      expect(tool.title).toContain("Deskohub Workspace");
      expect(tool.annotations?.title).toContain("Deskohub Workspace");
    }
  });

  test("lets ChatGPT call start_reservation without signing in, as a read-only tool", async () => {
    const tools = await listToolsAs(chatGpt);
    const startReservation = tools.find(
      ({ name }) => name === "start_reservation"
    );

    expect(
      Object.fromEntries(
        tools.map((tool) => [tool.name, tool["securitySchemes"]])
      )
    ).toMatchObject({
      start_reservation: [{ type: "noauth" }],
      get_reservation_status: [
        { type: "oauth2", scopes: ["reservations:read"] },
      ],
      list_my_reservations: [{ type: "oauth2", scopes: ["reservations:read"] }],
    });
    expect(startReservation?._meta?.["cz.deskohub.workspace/access"]).toBe(
      "public"
    );
    expect(startReservation?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
  });

  test("keeps the Claude apps' start_reservation a signed-in booking", async () => {
    const tools = await listToolsAs(claudeApp);
    const startReservation = tools.find(
      ({ name }) => name === "start_reservation"
    );

    expect(startReservation?.["securitySchemes"]).toEqual([
      { type: "oauth2", scopes: ["reservations:create"] },
    ]);
    expect(startReservation?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
    });
  });

  test("answers ChatGPT's start_reservation with the prefilled reservation page, booking nothing", async () => {
    bookingCalls.length = 0;
    const args = {
      family: "cowork",
      date: workspaceDateFromToday(2),
      tier: "open-space",
    };
    const callAsChatGpt = async (name: string) => {
      const response = await postRpc(
        "tools/call",
        { name, arguments: args },
        chatGpt
      );
      expect(response.status).toBe(200);
      const { result } = (await readJsonRpc(response)) as {
        readonly result: CallToolResult;
      };
      expect(result.isError).toBeFalsy();
      return result.structuredContent;
    };

    const [started, quote] = await Promise.all([
      callAsChatGpt("start_reservation"),
      callAsChatGpt("get_quote"),
    ]);

    expect(started).toEqual({
      family: "cowork",
      reservation_url: quote?.["reservation_url"],
      note: expect.any(String),
    });
    expect(bookingCalls).toEqual([]);
  });

  test("asks ChatGPT to sign in for the customer's own reservations", async () => {
    const response = await postRpc(
      "tools/call",
      { name: "list_my_reservations", arguments: {} },
      chatGpt
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      'scope="reservations:read"'
    );
  });

  test("lists every tool to a client it doesn't recognize, with how each authorizes", async () => {
    const tools = await listToolsAs({
      "user-agent": "claude-code/2.1.0 (cli)",
    });

    expect(tools.map(({ name }) => name)).toEqual([
      ...publicTools,
      "start_reservation",
      "get_reservation_status",
      "list_my_reservations",
      "whoami",
    ]);
    expect(
      Object.fromEntries(
        tools.map((tool) => [tool.name, tool["securitySchemes"]])
      )
    ).toEqual({
      list_offerings: [{ type: "noauth" }],
      check_availability: [{ type: "noauth" }],
      get_quote: [{ type: "noauth" }],
      show_booking: [{ type: "noauth" }],
      start_reservation: [{ type: "oauth2", scopes: ["reservations:create"] }],
      get_reservation_status: [
        { type: "oauth2", scopes: ["reservations:read"] },
      ],
      list_my_reservations: [{ type: "oauth2", scopes: ["reservations:read"] }],
      whoami: [{ type: "oauth2", scopes: ["reservations:read"] }],
    });
    for (const tool of tools) {
      expect(tool._meta?.["securitySchemes"]).toEqual(tool["securitySchemes"]);
    }
  });

  /** A 2026-07-28 request, whose `_meta` envelope names its client. */
  const postModernRpc = (
    method: string,
    clientName: string,
    headers: Record<string, string> = {}
  ) =>
    postRpc(
      method,
      {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": {
            name: clientName,
            version: "1.0.0",
          },
        },
      },
      { "mcp-protocol-version": "2026-07-28", "mcp-method": method, ...headers }
    );

  test.each([
    ["ChatGPT", "openai-mcp", {}, 8],
    // Claude Code through Anthropic's gateway shares the Claude apps'
    // User-Agent but names itself.
    ["Claude Code", "claude-code", claudeApp, 8],
  ])(
    "identifies %s by the clientInfo a 2026-era request carries",
    async (_, name, headers, count) => {
      const response = await postModernRpc("tools/list", name, headers);
      expect(response.status).toBe(200);
      const { result } = await readJsonRpc(response);

      expect(result.tools).toHaveLength(count);
      expect(result.tools[0].securitySchemes).toEqual([{ type: "noauth" }]);
    }
  );

  test("gives ChatGPT the catalog's instructions for ChatGPT", async () => {
    const { result } = await readJsonRpc(
      await postRpc(
        "initialize",
        {
          protocolVersion: legacyProtocolVersion,
          capabilities: {},
          clientInfo: { name: "openai-mcp", version: "1.0.0" },
        },
        chatGpt
      )
    );

    expect(result.instructions).toBe(
      customerAgentCatalog.forClient("chatgpt").instructions
    );
    expect(result.instructions).not.toBe(
      customerAgentCatalog.forClient("other").instructions
    );
  });

  test("keeps the reservation page and the Pay link for the Claude apps", async () => {
    const copy = await readListingCopy(claudeApp, "Anthropic/ClaudeAI");

    expect(copy).toContain("reservation_url");
    expect(copy).toContain("pay_url");
  });

  test.each([
    ["ChatGPT", chatGpt, "reservation_page"],
    ["the Claude apps", claudeApp, "reserve"],
  ])(
    "hands %s, signed in to book, off in the booking view as %s",
    async (_, headers, mode) => {
      accessTokens.set("create", "reservations:create");
      const response = await postRpc(
        "tools/call",
        { name: "show_booking", arguments: { family: "cowork" } },
        { ...headers, authorization: "Bearer create" }
      );
      const { result } = await readJsonRpc(response);

      expect(result.structuredContent.booking_mode).toBe(mode);
    }
  );

  test("gives ChatGPT's booking view the site as its widget domain", async () => {
    const { result } = await readJsonRpc(
      await postRpc(
        "resources/read",
        { uri: "ui://dh-workspace/booking-v2.html" },
        chatGpt
      )
    );

    expect(result.contents[0]._meta).toMatchObject({
      ui: { domain: "http://deskohub.test" },
      "openai/widgetDomain": "http://deskohub.test",
    });
  });

  test("names the site and its icons", async () => {
    const { result } = await rpc<InitializeResult>("initialize", {
      protocolVersion: legacyProtocolVersion,
      capabilities: {},
      clientInfo: { name: "openai-mcp", version: "1.0.0" },
    });

    expect(result?.serverInfo).toMatchObject({
      title: "Deskohub Workspace",
      websiteUrl: "http://deskohub.test",
      icons: [
        expect.objectContaining({
          src: "http://deskohub.test/favicon.png",
          mimeType: "image/png",
        }),
        expect.objectContaining({
          src: "http://deskohub.test/favicon.svg",
          mimeType: "image/svg+xml",
        }),
      ],
    });
  });
});
