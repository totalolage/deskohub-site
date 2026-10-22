import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { Schema } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { agentScopes, offlineAccessAgentScope } from "../../agent-scopes";
import {
  customerAgentConsentPath,
  customerAgentSignInPath,
} from "../../customer-agent-routes";

/**
 * OAuth endpoints a signed-in customer could otherwise call to register or
 * manage clients. Agents register only through Client ID Metadata Documents,
 * so the client-management API stays unreachable over HTTP.
 */
export const disabledCustomerAgentClientPaths = [
  "/oauth2/create-client",
  "/oauth2/get-client",
  "/oauth2/get-clients",
  "/oauth2/update-client",
  "/oauth2/client/rotate-secret",
  "/oauth2/delete-client",
  // Rewrites a consent's scopes without the consent step, which would let a
  // customer grant themselves the administration scope.
  "/oauth2/update-consent",
  "/oauth2/end-session",
];

/** Fetches an agent's Client ID Metadata Document. */
export type CustomerAgentClientMetadataTransport =
  typeof fetchClientMetadataResource;

/**
 * Seconds a rotated refresh token still gets the response that replaced it.
 * Matches the MCP plugin's default, stated here because the privacy notice
 * discloses it.
 */
export const customerAgentRefreshTokenReuseSeconds = 30;

const decodeResourceMetadata = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.Json)
);

/**
 * Adds what the MCP plugin leaves out of the protected-resource metadata
 * (RFC 9728): the server's name and the site pages that document it, its
 * privacy policy, and its terms. App directories show them to customers.
 * The pages are locale-agnostic; the proxy opens them in the visitor's
 * language.
 */
const describeProtectedResource =
  (
    onRequest: NonNullable<ReturnType<typeof mcp>["onRequest"]>,
    resource: string
  ): typeof onRequest =>
  async (request, ctx) => {
    const handled = await onRequest(request, ctx);
    if (
      !handled ||
      !("response" in handled) ||
      request.method !== "GET" ||
      !handled.response.ok ||
      !new URL(request.url).pathname.startsWith(
        "/.well-known/oauth-protected-resource"
      )
    ) {
      return handled;
    }
    const metadata = decodeResourceMetadata(await handled.response.json());
    return {
      response: Response.json(
        {
          ...metadata,
          resource_name: workspaceSiteConstants.brand.name,
          resource_documentation: new URL(
            "/ai-assistants",
            resource
          ).toString(),
          resource_policy_uri: new URL("/privacy-policy", resource).toString(),
          resource_tos_uri: new URL(
            "/terms-and-conditions",
            resource
          ).toString(),
        },
        { headers: handled.response.headers }
      ),
    };
  };

const accessTokenVerificationBody = Schema.toStandardSchemaV1(
  Schema.Struct({ token: Schema.String })
);

const clientLookupBody = Schema.toStandardSchemaV1(
  Schema.Struct({ clientId: Schema.String })
);

/**
 * The OAuth 2.1 authorization server that customers' AI agents sign in
 * through, for the customer MCP server at `resource`.
 *
 * - Agents identify themselves with Client ID Metadata Documents (MCP
 *   2026-07-28); dynamic client registration stays off.
 * - Access tokens are opaque and stored hashed (`disableJwtPlugin`), so every
 *   MCP request checks the token row: revocation and account deletion take
 *   effect on the next call, and no signing keys live in the database.
 * - Refresh tokens rotate with a 30-second reuse window, so a lost refresh
 *   response doesn't disconnect the assistant: a refresh repeated inside the
 *   window, after the first one has completed, gets the same tokens, which
 *   the provider keeps encrypted with the auth secret on the rotated token's
 *   row. Truly concurrent refreshes still race: the loser gets
 *   `invalid_grant`, but the grant survives. The daily auth cleanup clears
 *   the copy once the window has passed. Reusing a rotated refresh token
 *   after the window deletes every token that client holds for the
 *   customer, so the customer reconnects the assistant.
 * - `verifyCustomerAgentAccessToken` is a server-only endpoint that validates
 *   a token through the provider's own capability surface, so the MCP route
 *   in this app needs no introspection client or HTTP round trip.
 * - `findCustomerAgentClient` is a server-only endpoint that reads a client's
 *   public metadata without a customer session, for requests that carry
 *   only an agent's access token. A disabled client reads as unknown.
 */
export const makeCustomerAgentAuthorizationPlugins = ({
  resource,
  clientMetadataTransport = fetchClientMetadataResource,
}: {
  /** The canonical URL of this deployment's customer MCP server. */
  readonly resource: string;
  /**
   * Fetches agents' Client ID Metadata Documents. Defaults to the pinned
   * public-address Node transport; tests inject a stub instead of the network.
   */
  readonly clientMetadataTransport?: CustomerAgentClientMetadataTransport;
}) => {
  const mcpProvider = mcp({
    resource,
    loginPage: customerAgentSignInPath,
    consentPage: customerAgentConsentPath,
    disableJwtPlugin: true,
    refreshTokenReuseInterval: customerAgentRefreshTokenReuseSeconds,
    scopes: [...agentScopes, offlineAccessAgentScope],
    clientRegistrationDefaultScopes: [...agentScopes, offlineAccessAgentScope],
  });
  const provider = {
    ...mcpProvider,
    onRequest: describeProtectedResource(mcpProvider.onRequest, resource),
  };

  const accessTokenVerification = {
    id: "customer-agent-access-token",
    endpoints: {
      verifyCustomerAgentAccessToken: createAuthEndpoint(
        "/customer-agent/verify-access-token",
        {
          method: "POST",
          body: accessTokenVerificationBody,
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) =>
          getOAuthProviderApi(ctx, provider.options).validateAccessToken(
            ctx.body.token
          )
      ),
      findCustomerAgentClient: createAuthEndpoint(
        "/customer-agent/find-client",
        {
          method: "POST",
          body: clientLookupBody,
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const client = await getOAuthProviderApi(
            ctx,
            provider.options
          ).getClient(ctx.body.clientId);
          return client === null || client.disabled
            ? null
            : {
                client_id: client.clientId,
                client_name: client.name ?? undefined,
                client_uri: client.uri ?? undefined,
              };
        }
      ),
    },
  } satisfies BetterAuthPlugin;

  return [
    provider,
    cimd({
      fetchClientMetadataResource: clientMetadataTransport,
      metadataProfile: "mcp-2026-07-28",
    }),
    accessTokenVerification,
  ] as const;
};
