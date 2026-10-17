import { type BrowserContext, expect, test } from "@playwright/test";
import { workspaceE2ETimeouts } from "../timeouts";
import { enablePreviewAccess, requireBaseUrl } from "./navigation-test-helpers";

const protocolVersion = "2025-11-25";
const toolNames = ["list_offerings", "check_availability", "get_quote"];

type McpTool = {
  name: string;
  annotations?: { readOnlyHint?: boolean };
  inputSchema?: { type?: string };
};

type McpToolsListResult = {
  result?: { tools?: McpTool[] };
};

type McpOffering = {
  family?: string;
  tier?: string;
  price?: { amount?: number; currency?: string };
  reservation_url?: string;
};

type McpListOfferingsResult = {
  result?: {
    isError?: boolean;
    structuredContent?: {
      business?: { opening_hours?: string };
      offerings?: McpOffering[];
    };
  };
};

async function postMcpMessage(
  context: BrowserContext,
  message: Record<string, unknown>,
  includeProtocolVersion = false
) {
  return context.request.post("/api/mcp", {
    data: message,
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(includeProtocolVersion && {
        "MCP-Protocol-Version": protocolVersion,
      }),
    },
    timeout: workspaceE2ETimeouts.customerMcpRequest,
  });
}

test("serves public offerings through the customer MCP endpoint", async ({
  baseURL,
  context,
}, testInfo) => {
  test.skip(
    process.env.WORKSPACE_E2E_BASE_URL === undefined,
    "The customer MCP endpoint case requires a protected preview"
  );
  testInfo.setTimeout(workspaceE2ETimeouts.customerMcpCase);

  await test.step(
    "primes protected preview access",
    () => enablePreviewAccess(context, baseURL),
    { timeout: workspaceE2ETimeouts.browserAction }
  );

  await test.step(
    "initializes the stateless MCP connection",
    async () => {
      const response = await postMcpMessage(context, {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "deskohub-e2e", version: "1.0.0" },
        },
      });

      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("application/json");
      expect((await response.json()).result).toBeDefined();
      await response.dispose();
    },
    { timeout: workspaceE2ETimeouts.customerMcpRequest }
  );

  await test.step(
    "lists the public read-only MCP tools",
    async () => {
      const response = await postMcpMessage(
        context,
        { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
        true
      );
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("application/json");

      const payload = (await response.json()) as McpToolsListResult;
      const tools = payload.result?.tools ?? [];
      expect(tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining(toolNames)
      );
      for (const name of toolNames) {
        const tool = tools.find((candidate) => candidate.name === name);
        expect(tool?.annotations?.readOnlyHint).toBe(true);
        expect(tool?.inputSchema?.type).toBe("object");
      }
      await response.dispose();
    },
    { timeout: workspaceE2ETimeouts.customerMcpRequest }
  );

  await test.step(
    "calls list_offerings and checks the returned booking data",
    async () => {
      const response = await postMcpMessage(
        context,
        {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: {
            name: "list_offerings",
            arguments: { locale: "en-US" },
          },
        },
        true
      );
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain("application/json");

      const payload = (await response.json()) as McpListOfferingsResult;
      const result = payload.result;
      const structuredContent = result?.structuredContent;
      const offerings = structuredContent?.offerings ?? [];
      const previewOrigin = new URL(requireBaseUrl(baseURL)).origin;

      expect(result?.isError).toBeFalsy();
      expect(offerings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            family: "cowork",
            tier: "open-space",
            price: { amount: 290, currency: "CZK" },
          }),
        ])
      );
      expect(
        offerings.every(
          (offering) =>
            typeof offering.reservation_url === "string" &&
            offering.reservation_url.startsWith(previewOrigin)
        )
      ).toBe(true);

      const openingHours = structuredContent?.business?.opening_hours;
      expect(typeof openingHours).toBe("string");
      expect(openingHours?.trim().length ?? 0).toBeGreaterThan(0);
      await response.dispose();
    },
    { timeout: workspaceE2ETimeouts.customerMcpRequest }
  );
});
