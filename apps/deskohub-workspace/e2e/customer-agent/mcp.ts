import {
  type AuthorizationServerMetadata,
  Client,
  discoverOAuthServerInfo,
  exchangeAuthorization,
  extractWWWAuthenticateParams,
  type FetchLike,
  StreamableHTTPClientTransport,
  startAuthorization,
} from "@modelcontextprotocol/client";
import { Effect, Schema, type Scope } from "effect";
import { customerAgentTestClientRedirectUri } from "@/features/account/customer-agent-test-client";
import type { WorkspaceE2EConfig } from "../config";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  tryWorkspaceE2ESync,
  type WorkspaceE2EError,
} from "../errors";
import { addRedaction, assert } from "../runtime";
import {
  customerAgentRequestedScopes,
  customerMcpResourceFor,
} from "./authorization";

/**
 * Plain `fetch` to the protected preview, as a hosted agent calls it: the
 * automation bypass header and nothing from the browser, so a bearer token
 * is the request's only credential.
 */
const previewFetch =
  (config: WorkspaceE2EConfig, signal: AbortSignal): FetchLike =>
  (url, init) => {
    const headers = new Headers(init?.headers);
    if (config.bypassSecret) {
      headers.set("x-vercel-protection-bypass", config.bypassSecret);
    }
    return fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(config.timeouts.customerMcpRequest),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  };

const protectedResourceMetadataPath =
  "/.well-known/oauth-protected-resource/api/mcp";

export type CustomerAgentAuthorizationServer = {
  readonly metadata: AuthorizationServerMetadata;
  readonly url: string;
};

/**
 * Calls a signed-in tool without a token, as an agent does before it has
 * one, and follows the OAuth challenge: the 401's `resource_metadata` must
 * name this deployment's protected-resource document, which binds the MCP
 * resource to its authorization server.
 */
export const discoverCustomerAgentAuthorization = (
  config: WorkspaceE2EConfig
): Effect.Effect<CustomerAgentAuthorizationServer, WorkspaceE2EError> =>
  tryWorkspaceE2EPromise(
    "discover customer agent authorization",
    async (signal) => {
      const fetchFn = previewFetch(config, signal);
      const resource = customerMcpResourceFor(config.baseUrl);
      const challenge = await fetchFn(resource, {
        body: JSON.stringify({
          id: 1,
          jsonrpc: "2.0",
          method: "tools/call",
          params: { arguments: {}, name: "list_my_reservations" },
        }),
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "mcp-protocol-version": "2025-11-25",
        },
        method: "POST",
      });
      await challenge.body?.cancel();
      assert(
        challenge.status === 401,
        `A signed-in tool without a token answered ${challenge.status}, not 401`
      );
      const { resourceMetadataUrl } = extractWWWAuthenticateParams(challenge);
      assert(
        resourceMetadataUrl?.toString() ===
          new URL(protectedResourceMetadataPath, config.baseUrl).toString(),
        "The 401 challenge does not name the deployment's protected-resource metadata"
      );
      const server = await discoverOAuthServerInfo(resource, {
        fetchFn,
        resourceMetadataUrl,
      });
      assert(
        server.resourceMetadata?.resource === resource,
        "The protected-resource metadata describes another resource"
      );
      assert(
        server.authorizationServerMetadata,
        "The authorization server publishes no metadata"
      );
      return {
        metadata: server.authorizationServerMetadata,
        url: server.authorizationServerUrl,
      };
    }
  );

export type CustomerAgentAuthorizationRequest = {
  readonly authorizationUrl: string;
  readonly codeVerifier: string;
  readonly state: string;
};

/** A fresh authorization request with a PKCE (S256) challenge and state. */
export const startCustomerAgentAuthorization = ({
  clientId,
  config,
  server,
}: {
  readonly clientId: string;
  readonly config: WorkspaceE2EConfig;
  readonly server: CustomerAgentAuthorizationServer;
}): Effect.Effect<CustomerAgentAuthorizationRequest, WorkspaceE2EError> =>
  tryWorkspaceE2EPromise("start customer agent authorization", async () => {
    const state = crypto.randomUUID();
    const { authorizationUrl, codeVerifier } = await startAuthorization(
      server.url,
      {
        clientInformation: { client_id: clientId },
        metadata: server.metadata,
        redirectUrl: customerAgentTestClientRedirectUri,
        resource: customerMcpResourceFor(config.baseUrl),
        scope: customerAgentRequestedScopes.join(" "),
        state,
      }
    );
    assert(
      authorizationUrl.searchParams.get("code_challenge_method") === "S256",
      "The authorization request does not use an S256 PKCE challenge"
    );
    addRedaction(codeVerifier, true);
    return {
      authorizationUrl: authorizationUrl.toString(),
      codeVerifier,
      state,
    };
  });

/**
 * Redeems the code at the token endpoint with the PKCE verifier, bound to
 * the MCP resource, and returns the opaque access token.
 */
export const exchangeCustomerAgentCode = ({
  clientId,
  code,
  config,
  iss,
  request,
  server,
}: {
  readonly clientId: string;
  readonly code: string;
  readonly config: WorkspaceE2EConfig;
  readonly iss: string | undefined;
  readonly request: CustomerAgentAuthorizationRequest;
  readonly server: CustomerAgentAuthorizationServer;
}): Effect.Effect<string, WorkspaceE2EError> =>
  tryWorkspaceE2EPromise("exchange customer agent code", async (signal) => {
    const tokens = await exchangeAuthorization(server.url, {
      authorizationCode: code,
      clientInformation: { client_id: clientId },
      codeVerifier: request.codeVerifier,
      fetchFn: previewFetch(config, signal),
      iss,
      metadata: server.metadata,
      redirectUri: customerAgentTestClientRedirectUri,
      resource: customerMcpResourceFor(config.baseUrl),
    });
    addRedaction(tokens.access_token, true);
    addRedaction(tokens.refresh_token, true);
    assert(
      tokens.token_type.toLowerCase() === "bearer",
      "The token endpoint issued a non-bearer token"
    );
    const granted = new Set(tokens.scope?.split(" "));
    assert(
      customerAgentRequestedScopes.every((scope) => granted.has(scope)),
      "The token endpoint granted fewer scopes than the customer allowed"
    );
    assert(
      tokens.refresh_token,
      "The token endpoint issued no refresh token for offline access"
    );
    return tokens.access_token;
  });

/**
 * An MCP client that sends the access token as its bearer credential,
 * closed with the scope.
 */
export const connectCustomerMcp = ({
  accessToken,
  config,
}: {
  readonly accessToken: string;
  readonly config: WorkspaceE2EConfig;
}): Effect.Effect<Client, WorkspaceE2EError, Scope.Scope> =>
  Effect.acquireRelease(
    tryWorkspaceE2EPromise("connect customer MCP client", async (signal) => {
      const client = new Client({
        name: "deskohub-e2e-agent",
        version: "1.0.0",
      });
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(customerMcpResourceFor(config.baseUrl)),
          {
            authProvider: { token: async () => accessToken },
            fetch: previewFetch(config, signal),
          }
        ),
        { timeout: config.timeouts.customerMcpRequest }
      );
      return client;
    }),
    (client) => Effect.promise(() => client.close())
  );

/**
 * Calls one tool and decodes its structured result. A tool error is a
 * failure that carries the tool's own message.
 */
export const callCustomerMcpTool = <A>({
  arguments: toolArguments,
  client,
  config,
  name,
  schema,
}: {
  readonly arguments: Record<string, unknown>;
  readonly client: Client;
  readonly config: WorkspaceE2EConfig;
  readonly name: string;
  readonly schema: Schema.Decoder<A>;
}): Effect.Effect<A, WorkspaceE2EError> =>
  Effect.gen(function* () {
    const result = yield* tryWorkspaceE2EPromise(`call MCP ${name}`, () =>
      client.callTool(
        { arguments: toolArguments, name },
        { timeout: config.timeouts.customerMcpRequest }
      )
    );
    yield* tryWorkspaceE2ESync(`read MCP ${name} result`, () =>
      assert(
        !result.isError,
        `MCP ${name} failed: ${JSON.stringify(result.content)}`
      )
    );
    return yield* Schema.decodeUnknownEffect(schema)(
      result.structuredContent
    ).pipe(
      Effect.mapError((cause) =>
        toWorkspaceE2EError(`decode MCP ${name} result`, cause)
      )
    );
  });
