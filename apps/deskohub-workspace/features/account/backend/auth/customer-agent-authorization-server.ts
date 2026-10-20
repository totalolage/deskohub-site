import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import { getOAuthProviderApi } from "@better-auth/oauth-provider";
import type { BetterAuthPlugin } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { Schema } from "effect";
import {
  customerAgentConsentPath,
  customerAgentSignInPath,
} from "../../customer-agent-routes";
import {
  customerAgentOfflineAccessScope,
  customerAgentScopes,
} from "../../customer-agent-scopes";

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

const accessTokenVerificationBody = Schema.toStandardSchemaV1(
  Schema.Struct({ token: Schema.String })
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
 * - Refresh tokens rotate with a 30-second reuse window, so a refresh race or
 *   a lost refresh response doesn't disconnect the assistant: a repeated
 *   refresh inside the window gets the same token response, which the
 *   provider keeps encrypted with the auth secret on the rotated token's row.
 *   The daily auth cleanup clears that copy once the window has passed.
 *   Reusing a rotated refresh token after the window deletes every token
 *   that client holds for the customer, so the customer reconnects the
 *   assistant.
 * - `verifyCustomerAgentAccessToken` is a server-only endpoint that validates
 *   a token through the provider's own capability surface, so the MCP route
 *   in this app needs no introspection client or HTTP round trip.
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
  const provider = mcp({
    resource,
    loginPage: customerAgentSignInPath,
    consentPage: customerAgentConsentPath,
    disableJwtPlugin: true,
    refreshTokenReuseInterval: customerAgentRefreshTokenReuseSeconds,
    scopes: [...customerAgentScopes, customerAgentOfflineAccessScope],
    clientRegistrationDefaultScopes: [
      ...customerAgentScopes,
      customerAgentOfflineAccessScope,
    ],
  });

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
