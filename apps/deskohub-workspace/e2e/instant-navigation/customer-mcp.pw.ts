import "@/shared/polyfills/temporal";

import {
  Client,
  type FetchLike,
  StreamableHTTPClientTransport,
  type VersionNegotiationMode,
} from "@modelcontextprotocol/client";
import { type BrowserContext, expect, test } from "@playwright/test";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { enablePreviewAccess } from "../preview-access";
import { workspaceE2ETimeouts } from "../timeouts";
import { requireBaseUrl } from "./navigation-test-helpers";

const toolNames = ["list_offerings", "check_availability", "get_quote"];

type McpOffering = {
  family?: string;
  tier?: string;
  reservation_url?: string;
};

type McpOfferingsContent = {
  business?: { opening_hours?: string };
  offerings?: McpOffering[];
};

type McpAvailabilityContent = {
  family?: string;
  available?: boolean;
  days?: { date?: string; available?: boolean }[];
  reservation_url?: string;
};

type McpQuoteContent = {
  family?: string;
  total?: { amount?: number; currency?: string };
  reservation_url?: string;
};

/**
 * Sends the SDK client's requests through the Playwright context, so they
 * carry its preview bypass cookie and show up in the trace. With `origin`,
 * they also carry the `Origin` a browser page on that origin would send.
 */
const contextFetch =
  (context: BrowserContext, origin?: string): FetchLike =>
  async (url, init) => {
    if (init?.body != null && typeof init.body !== "string") {
      throw new TypeError("The MCP client sent a non-text request body");
    }
    const requestHeaders = new Headers(init?.headers);
    if (origin !== undefined) requestHeaders.set("origin", origin);
    const response = await context.request.fetch(url.toString(), {
      method: init?.method ?? "GET",
      headers: Object.fromEntries(requestHeaders),
      data: init?.body ?? undefined,
      timeout: workspaceE2ETimeouts.customerMcpRequest,
    });
    const body = new Uint8Array(await response.body());
    const headers = new Headers(
      response
        .headersArray()
        .map(({ name, value }): [string, string] => [name, value])
    );
    const status = response.status();
    const statusText = response.statusText();
    await response.dispose();

    return new Response(body.byteLength > 0 ? body : null, {
      headers,
      status,
      statusText,
    });
  };

// `legacy` is the SDK default: the 2025-era `initialize` handshake, answered
// as an event stream. `auto` first probes the 2026-era `server/discover`.
// The legacy client sends no `Origin`, as a hosted connector does; the auto
// client sends the preview's own, as a page on the deployment would.
for (const { versionNegotiation, sendsOwnOrigin } of [
  { versionNegotiation: "legacy", sendsOwnOrigin: false },
  { versionNegotiation: "auto", sendsOwnOrigin: true },
] as const satisfies readonly {
  versionNegotiation: VersionNegotiationMode;
  sendsOwnOrigin: boolean;
}[]) {
  test(`serves public offerings to an MCP client in ${versionNegotiation} version negotiation`, async ({
    baseURL,
    context,
  }, testInfo) => {
    test.skip(
      process.env.WORKSPACE_E2E_BASE_URL === undefined,
      "The customer MCP endpoint case requires a protected preview"
    );
    testInfo.setTimeout(workspaceE2ETimeouts.customerMcpCase);

    const previewOrigin = new URL(requireBaseUrl(baseURL)).origin;
    const requestOptions = { timeout: workspaceE2ETimeouts.customerMcpRequest };
    const client = new Client(
      { name: "deskohub-e2e", version: "1.0.0" },
      { versionNegotiation: { mode: versionNegotiation } }
    );

    await test.step(
      "primes protected preview access",
      () => enablePreviewAccess(context, baseURL),
      { timeout: workspaceE2ETimeouts.browserAction }
    );

    try {
      await test.step(
        "connects to the stateless MCP endpoint",
        async () => {
          await client.connect(
            new StreamableHTTPClientTransport(
              new URL("/api/mcp", previewOrigin),
              {
                fetch: contextFetch(
                  context,
                  sendsOwnOrigin ? previewOrigin : undefined
                ),
              }
            ),
            requestOptions
          );
          expect(client.getServerVersion()?.name).toBeTruthy();
        },
        { timeout: workspaceE2ETimeouts.customerMcpRequest }
      );

      await test.step(
        "lists the public read-only MCP tools",
        async () => {
          const { tools } = await client.listTools(undefined, requestOptions);
          expect(tools.map((tool) => tool.name)).toEqual(
            expect.arrayContaining(toolNames)
          );
          for (const name of toolNames) {
            const tool = tools.find((candidate) => candidate.name === name);
            expect(tool?.annotations?.readOnlyHint).toBe(true);
            expect(tool?.inputSchema.type).toBe("object");
          }
        },
        { timeout: workspaceE2ETimeouts.customerMcpRequest }
      );

      await test.step(
        "calls list_offerings and checks the returned booking data",
        async () => {
          const result = await client.callTool(
            { name: "list_offerings", arguments: { locale: "en-US" } },
            requestOptions
          );
          const content = result.structuredContent as
            | McpOfferingsContent
            | undefined;
          const offerings = content?.offerings ?? [];

          expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
          expect(offerings).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                family: "cowork",
                tier: "open-space",
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

          const openingHours = content?.business?.opening_hours;
          expect(typeof openingHours).toBe("string");
          expect(openingHours?.trim().length ?? 0).toBeGreaterThan(0);
        },
        { timeout: workspaceE2ETimeouts.customerMcpRequest }
      );

      const date = getCurrentWorkspaceDate().add({ days: 2 }).toString();
      const selection = { family: "cowork", date, tier: "open-space" };

      await test.step(
        "calls check_availability for an open-space desk",
        async () => {
          const result = await client.callTool(
            { name: "check_availability", arguments: selection },
            requestOptions
          );
          const content = result.structuredContent as
            | McpAvailabilityContent
            | undefined;

          expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
          expect(content).toMatchObject({
            family: "cowork",
            available: expect.any(Boolean),
            days: [expect.objectContaining({ date })],
          });
          expect(content?.reservation_url?.startsWith(previewOrigin)).toBe(
            true
          );
        },
        { timeout: workspaceE2ETimeouts.customerMcpRequest }
      );

      await test.step(
        "calls get_quote for an open-space desk",
        async () => {
          const result = await client.callTool(
            { name: "get_quote", arguments: selection },
            requestOptions
          );
          const content = result.structuredContent as
            | McpQuoteContent
            | undefined;

          expect(result.isError, JSON.stringify(result.content)).toBeFalsy();
          expect(content).toMatchObject({
            family: "cowork",
            total: { amount: expect.any(Number), currency: "CZK" },
          });
          expect(content?.total?.amount ?? 0).toBeGreaterThan(0);
          expect(content?.reservation_url?.startsWith(previewOrigin)).toBe(
            true
          );
        },
        { timeout: workspaceE2ETimeouts.customerMcpRequest }
      );
    } finally {
      await client.close();
    }
  });
}
