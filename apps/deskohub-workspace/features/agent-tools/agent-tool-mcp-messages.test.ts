import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { readMcpRequest } from "./agent-tool-mcp-messages";

const post = (body: string) =>
  new Request("http://deskohub.test/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

const read = (request: Request) => Effect.runPromise(readMcpRequest(request));

describe("readMcpRequest", () => {
  test("reads a single message, or each message of a batch", async () => {
    const message = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    const batch = [message, { ...message, id: 2 }];

    expect((await read(post(JSON.stringify(message)))).messages).toEqual([
      message,
    ]);
    expect((await read(post(JSON.stringify(batch)))).messages).toEqual(batch);
  });

  test("reads no message from a body that isn't JSON", async () => {
    const { messages } = await read(post("not json"));

    expect(messages.filter((message) => message !== null)).toEqual([]);
  });

  test("leaves the body for the MCP server to read", async () => {
    const request = post(JSON.stringify({ jsonrpc: "2.0", id: 1 }));
    const mcpRequest = await read(request);

    expect(mcpRequest.request).toBe(request);
    expect(request.bodyUsed).toBe(false);
    await expect(request.json()).resolves.toEqual({ jsonrpc: "2.0", id: 1 });
  });
});
