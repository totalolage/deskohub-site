import { describe, expect, mock, test } from "bun:test";
import {
  customerAgentTestClientMetadata,
  customerAgentTestClientPathname,
} from "@/features/account/customer-agent-test-client";

// Tests run outside a request, where Next's `connection()` would throw.
const nextServer = await import("next/server");
mock.module("next/server", () => ({
  ...nextServer,
  connection: () => Promise.resolve(),
}));

// Load the route through the document's pathname, so the test fails when the
// route folder and the published client ID drift apart.
const { GET } = await import(
  `../../..${customerAgentTestClientPathname}/route`
);

describe("test agent Client ID Metadata Document", () => {
  test("serves the document as JSON cached for a minute", async () => {
    const response: Response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toStartWith(
      "application/json"
    );
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await response.json()).toEqual(customerAgentTestClientMetadata);
  });

  test("names its own production URL as the client ID", () => {
    expect(customerAgentTestClientMetadata.client_id).toBe(
      "https://workspace.deskohub.cz/oauth/clients/e2e-agent.json"
    );
  });
});
