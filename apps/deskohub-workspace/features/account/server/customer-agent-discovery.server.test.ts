import "@/shared/testing/workspace-test-env";

// Bun skips dot directories when it collects tests, so the `.well-known`
// route handlers are covered here, next to the handler they share.

import { describe, expect, mock, test } from "bun:test";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import { agentScopes } from "@/features/account/agent-scopes";
import {
  HOST,
  makeMemoryTestAuth,
} from "@/features/account/backend/auth/auth-handler.test-utils";

const { auth } = makeMemoryTestAuth();
mock.module("@/features/account/server/auth.server", () => ({ auth }));

// Outside a request, Next's `connection()` throws; the routes call it so
// the build never prerenders them.
const nextServer = await import("next/server");
const connection = mock(() => Promise.resolve());
mock.module("next/server", () => ({ ...nextServer, connection }));

const authorizationServerRoute = await import(
  "@/app/.well-known/oauth-authorization-server/api/auth/route"
);
const protectedResourceRoute = await import(
  "@/app/.well-known/oauth-protected-resource/route"
);
const mcpProtectedResourceRoute = await import(
  "@/app/.well-known/oauth-protected-resource/api/mcp/route"
);

const origin = `https://${HOST}`;
const issuer = `${origin}/api/auth`;
const resource = `${origin}/api/mcp`;

const get =
  (route: { GET: (request: Request) => Promise<Response> }) => (path: string) =>
    route.GET(new Request(`${origin}${path}`));

describe("customer agent OAuth discovery", () => {
  test("renders every document per request, never at build time", async () => {
    connection.mockClear();
    await get(protectedResourceRoute)("/.well-known/oauth-protected-resource");
    await get(mcpProtectedResourceRoute)(
      "/.well-known/oauth-protected-resource/api/mcp"
    );
    await get(authorizationServerRoute)(
      "/.well-known/oauth-authorization-server/api/auth"
    );

    expect(connection).toHaveBeenCalledTimes(3);
  });

  test("serves the authorization-server metadata at the issuer's path-inserted URL", async () => {
    const response = await get(authorizationServerRoute)(
      "/.well-known/oauth-authorization-server/api/auth"
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const metadata = await response.json();
    expect(metadata).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/oauth2/authorize`,
      token_endpoint: `${issuer}/oauth2/token`,
      client_id_metadata_document_supported: true,
      // RFC 9207, which ChatGPT requires for its stable client ID.
      authorization_response_iss_parameter_supported: true,
    });
    // Claude picks metadata documents over registration only with `none`;
    // ChatGPT's document authenticates with `private_key_jwt`.
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(
      expect.arrayContaining(["none", "private_key_jwt"])
    );
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.scopes_supported).toEqual(
      expect.arrayContaining([...agentScopes, "offline_access"])
    );
    expect(metadata).not.toHaveProperty("registration_endpoint");
  });

  test.each([
    ["the MCP server path", mcpProtectedResourceRoute, "/api/mcp"],
    ["the root", protectedResourceRoute, ""],
  ])(
    "serves the MCP server's protected-resource metadata at %s",
    async (_, route, suffix) => {
      const response = await get(route)(
        `/.well-known/oauth-protected-resource${suffix}`
      );

      expect(response.status).toBe(200);
      const metadata = await response.json();
      expect(metadata).toMatchObject({
        resource,
        authorization_servers: [issuer],
      });
      expect(metadata.scopes_supported).toEqual([...agentScopes]);
      expect(metadata).toMatchObject({
        resource_name: expect.any(String),
        resource_documentation: `${origin}/ai-assistants`,
        resource_policy_uri: `${origin}/privacy-policy`,
        resource_tos_uri: `${origin}/terms-and-conditions`,
      });
    }
  );

  test("serves the metadata URL the MCP server's challenges name", async () => {
    const challenge = createResourceServerChallenge(
      new APIError("UNAUTHORIZED", { message: "missing token" }),
      resource
    );
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(
      new Headers(challenge?.headers).get("WWW-Authenticate") ?? ""
    )?.[1];

    expect(metadataUrl).toBe(
      `${origin}/.well-known/oauth-protected-resource/api/mcp`
    );
    const response = await mcpProtectedResourceRoute.GET(
      new Request(metadataUrl ?? "")
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource });
  });

  test("answers HEAD without a body", async () => {
    const response = await mcpProtectedResourceRoute.HEAD(
      new Request(`${origin}/.well-known/oauth-protected-resource/api/mcp`, {
        method: "HEAD",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
  });
});
