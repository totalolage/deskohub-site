import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Effect, Layer, Schema } from "effect";
import type { AgentTrafficEvent } from "@/shared/backend/agent-traffic/agent-traffic-events";
import { CurrentAgentTraffic } from "@/shared/backend/workspace-request-context";

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

const {
  agentToolLocaleField,
  CallableAgentTools,
  defineAgentTool,
  defineSignedInAgentTool,
  selectAgentTools,
} = await import("./agent-tool");
const { CustomerAgentAuthorization } = await import("@/features/account");
const { AgentToolAdmission } = await import("./agent-tool-admission.service");
const { answerAgentToolMcpRequest } = await import("./agent-tool-mcp-handler");

const endpoint = "http://deskohub.test/api/mcp";

let interruptions = 0;

/** Answers after a delay, so a 2025-era call streams before the result. */
const slowTool = defineAgentTool({
  name: "slow_echo",
  title: "Slow echo",
  description: "Echoes the seats after a delay.",
  access: "public",
  readOnly: true,
  unavailableCode: "quote_unavailable",
  input: Schema.Struct({
    seats: Schema.Int,
    wait: Schema.optionalKey(Schema.Literal("forever")),
    locale: agentToolLocaleField,
  }),
  output: Schema.Struct({ seats: Schema.Int }),
  run: ({ seats, wait }) =>
    (wait === "forever" ? Effect.never : Effect.sleep("50 millis")).pipe(
      Effect.as({ seats }),
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interruptions += 1;
        })
      )
    ),
});

const answer = (request: Request, admitted = true) =>
  Effect.runPromise(
    answerAgentToolMcpRequest({
      tools: [slowTool],
      client: "other",
      request,
    }).pipe(
      Effect.provide(
        Layer.succeed(AgentToolAdmission, {
          isCallAllowed: () => Effect.succeed(admitted),
        })
      ),
      Effect.provideService(CurrentAgentTraffic, {
        category: "ai_user_agent",
        name: "claude",
      })
    )
  );

const callLegacy = (
  args: Schema.JsonObject,
  {
    url = endpoint,
    origin,
    admitted,
  }: { url?: string; origin?: string; admitted?: boolean } = {}
) =>
  answer(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
        ...(origin !== undefined && { origin }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "slow_echo", arguments: args },
      }),
    }),
    admitted
  );

const readEventStreamResult = async (response: Response) => {
  const data = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .at(-1)
    ?.slice("data:".length);
  return JSON.parse(data ?? "null")?.result as CallToolResult | undefined;
};

/** Connects a 2026-era client that sends `origin`, as a browser page would. */
const connectClient = async ({
  url = endpoint,
  origin,
}: {
  url?: string;
  origin?: string;
} = {}) => {
  const client = new Client(
    { name: "handler-test", version: "1.0.0" },
    { versionNegotiation: { mode: "auto" } }
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      fetch: (input: string | URL | Request, init?: RequestInit) => {
        const request = new Request(input, init);
        if (origin !== undefined) request.headers.set("origin", origin);
        return answer(request);
      },
    })
  );
  return client;
};

beforeEach(() => {
  scheduledEvents.length = 0;
});

describe("answerAgentToolMcpRequest", () => {
  test("keeps a 2025-era call running until its event stream ends", async () => {
    const response = await callLegacy({ seats: 3 });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await readEventStreamResult(response)).toMatchObject({
      structuredContent: { seats: 3 },
    });
    expect(interruptions).toBe(0);
  });

  test("answers a slow call on the 2026 leg", async () => {
    const client = await connectClient();

    const result = await client.callTool({
      name: "slow_echo",
      arguments: { seats: 2 },
    });
    await client.close();

    expect(result.structuredContent).toEqual({ seats: 2 });
  });

  test("interrupts the call when the client cancels the stream", async () => {
    const before = interruptions;
    const response = await callLegacy({ seats: 1, wait: "forever" });

    await response.body?.cancel();
    for (let attempt = 0; attempt < 50 && interruptions === before; attempt++) {
      await Bun.sleep(10);
    }

    expect(interruptions).toBe(before + 1);
  });

  // Vercel routes only the project's own domains and aliases to a deployment.
  const servingHosts = [
    ["production", "workspace.deskohub.cz"],
    ["preview", "deskohub-workspace-git-feature-totalolage.vercel.app"],
    ["custom domain", "book.example.cz"],
  ] as const;

  for (const [kind, host] of servingHosts) {
    const url = `https://${host}/api/mcp`;
    const ownOrigin = `https://${host}`;

    test(`serves a browser on the ${kind} host's own origin on both protocol versions`, async () => {
      const legacy = await callLegacy({ seats: 4 }, { url, origin: ownOrigin });
      const client = await connectClient({ url, origin: ownOrigin });
      const current = await client.callTool({
        name: "slow_echo",
        arguments: { seats: 5 },
      });
      await client.close();

      expect(legacy.status).toBe(200);
      expect(await readEventStreamResult(legacy)).toMatchObject({
        structuredContent: { seats: 4 },
      });
      expect(current.structuredContent).toEqual({ seats: 5 });
    });

    test(`rejects other and opaque origins on the ${kind} host on both protocol versions`, async () => {
      for (const origin of [
        "https://attacker.example",
        "null",
        `https://${host}.attacker.example`,
      ]) {
        const legacy = await callLegacy({ seats: 1 }, { url, origin });

        expect(legacy.status).toBe(403);
        await expect(connectClient({ url, origin })).rejects.toThrow();
      }
    });
  }

  test("rejects a browser on another of the deployment's hosts", async () => {
    const response = await callLegacy(
      { seats: 1 },
      {
        url: "https://deskohub-workspace-git-feature-totalolage.vercel.app/api/mcp",
        origin: "https://workspace.deskohub.cz",
      }
    );

    expect(response.status).toBe(403);
  });

  test("counts each tool call by the caller's agent category", async () => {
    await readEventStreamResult(await callLegacy({ seats: 3 }));
    await readEventStreamResult(await callLegacy({ seats: "three" }));

    expect(scheduledEvents).toEqual([
      {
        event: "agent tool call",
        traffic: { category: "ai_user_agent", name: "claude" },
        properties: { tool: "slow_echo", outcome: "success" },
        timestamp: expect.any(Temporal.Instant),
      },
      {
        event: "agent tool call",
        traffic: { category: "ai_user_agent", name: "claude" },
        properties: { tool: "slow_echo", outcome: "invalid_input" },
        timestamp: expect.any(Temporal.Instant),
      },
    ]);
  });

  test("counts a rate-limited call by its error code", async () => {
    const response = await callLegacy({ seats: 1 }, { admitted: false });

    expect(await readEventStreamResult(response)).toMatchObject({
      isError: true,
    });
    expect(scheduledEvents).toMatchObject([
      { properties: { tool: "slow_echo", outcome: "rate_limited" } },
    ]);
  });
});

describe("tools a call's caller may call", () => {
  /** Answers with the names `CallableAgentTools` holds for its call. */
  const callableTool = defineAgentTool({
    name: "callable_tools",
    title: "Callable tools",
    description: "Lists the tools the caller may call.",
    access: "public",
    readOnly: true,
    unavailableCode: "offerings_unavailable",
    input: Schema.Struct({ locale: agentToolLocaleField }),
    output: Schema.Struct({ names: Schema.Array(Schema.String) }),
    run: () =>
      CallableAgentTools.pipe(
        Effect.map((names) => ({ names: [...names].sort() }))
      ),
  });
  const signedInTool = (
    name: string,
    scope: "reservations:create" | "reservations:read",
    readOnly: boolean
  ) =>
    defineSignedInAgentTool({
      name,
      title: name,
      description: name,
      scope,
      readOnly,
      unavailableCode: "reservation_unavailable",
      input: Schema.Struct({ locale: agentToolLocaleField }),
      output: Schema.Struct({}),
      run: () => Effect.succeed({}),
    });
  const tools = [
    callableTool,
    signedInTool("book", "reservations:create", false),
    signedInTool("read_bookings", "reservations:read", true),
  ];

  const callCallableTools = async ({
    scopes,
    transactional = true,
  }: {
    readonly scopes?: ReadonlyArray<
      "reservations:create" | "reservations:read"
    >;
    readonly transactional?: boolean;
  }) => {
    const response = await Effect.runPromise(
      answerAgentToolMcpRequest({
        tools: selectAgentTools(tools, {
          access: ["public", "signed-in"],
          transactional,
        }),
        client: "other",
        request: new Request(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-protocol-version": "2025-11-25",
            ...(scopes && { authorization: "Bearer synthetic-token" }),
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "callable_tools", arguments: {} },
          }),
        }),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(AgentToolAdmission, {
              isCallAllowed: () => Effect.succeed(true),
            }),
            Layer.succeed(CustomerAgentAuthorization, {
              authorize: () =>
                Effect.succeed({
                  accountId: "synthetic-account",
                  clientId: "https://agent.example/client.json",
                  scopes: new Set(scopes),
                }),
            } as never)
          )
        ),
        Effect.provideService(CurrentAgentTraffic, {
          category: "ai_user_agent",
          name: "claude",
        })
      )
    );
    return (await readEventStreamResult(response))?.structuredContent;
  };

  test("holds only the public tools without a token", async () => {
    await expect(callCallableTools({})).resolves.toEqual({
      names: ["callable_tools"],
    });
  });

  test("adds the signed-in tools the token's scopes grant", async () => {
    await expect(
      callCallableTools({ scopes: ["reservations:create"] })
    ).resolves.toEqual({ names: ["book", "callable_tools"] });
    await expect(
      callCallableTools({
        scopes: ["reservations:create", "reservations:read"],
      })
    ).resolves.toEqual({ names: ["book", "callable_tools", "read_bookings"] });
  });

  test("leaves out tools a read-only deployment doesn't publish, whatever the token grants", async () => {
    await expect(
      callCallableTools({
        scopes: ["reservations:create", "reservations:read"],
        transactional: false,
      })
    ).resolves.toEqual({ names: ["callable_tools", "read_bookings"] });
  });
});
