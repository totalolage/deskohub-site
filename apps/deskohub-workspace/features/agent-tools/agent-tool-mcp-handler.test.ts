import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  type CallToolResult,
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Effect, Layer, Schema } from "effect";
import { agentToolLocaleField, defineAgentTool } from "./agent-tool";
import { AgentToolAdmission } from "./agent-tool-admission.service";
import { answerAgentToolMcpRequest } from "./agent-tool-mcp-handler";

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

const admitAll = Layer.succeed(AgentToolAdmission, {
  isCallAllowed: () => Effect.succeed(true),
});

const answer = (request: Request) =>
  Effect.runPromise(
    answerAgentToolMcpRequest({
      tools: [slowTool],
      request,
      allowedOriginHostnames: ["deskohub.test"],
    }).pipe(Effect.provide(admitAll))
  );

const callLegacy = (args: Schema.JsonObject) =>
  answer(
    new Request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": "2025-11-25",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "slow_echo", arguments: args },
      }),
    })
  );

const readEventStreamResult = async (response: Response) => {
  const data = (await response.text())
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .at(-1)
    ?.slice("data:".length);
  return JSON.parse(data ?? "null")?.result as CallToolResult | undefined;
};

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
    const client = new Client(
      { name: "handler-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        fetch: (input: string | URL | Request, init?: RequestInit) =>
          answer(new Request(input, init)),
      })
    );

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
});
