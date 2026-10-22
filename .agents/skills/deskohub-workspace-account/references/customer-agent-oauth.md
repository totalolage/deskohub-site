# Customer agent OAuth

Customers connect AI agents (ChatGPT, Claude, other MCP clients) to their
account through an OAuth 2.1 authorization server inside the same Better Auth
instance. The customer MCP server at `/api/mcp` is its only protected
resource.

## Where things live

| Concern | Location |
| --- | --- |
| Plugins (`mcp`, `cimd`, the token-verification endpoint) | `features/account/backend/auth/customer-agent-authorization-server.ts` |
| Scopes | `features/account/customer-agent-scopes.ts` |
| Login, consent, MCP and authorize paths; the connect-step resolver | `features/account/customer-agent-routes.ts` |
| Token → customer identity adapter | `features/account/backend/auth/customer-agent-authorization.service.ts` |
| Client name and host for the consent page | `features/account/backend/auth/customer-agent-client-directory.service.ts` |
| The customer's connected assistants (consents named by the client directory) | `features/account/backend/auth/customer-agent-connections.service.ts` |
| Connected assistants section and Disconnect | `features/account/components/customer-agent-connections/`, `features/account/customer-agent-connection-client.ts` |
| Discovery handler and its tests | `features/account/server/customer-agent-discovery.server.ts` (+ `.test.ts`) |
| Discovery routes | `app/.well-known/oauth-authorization-server/api/auth`, `app/.well-known/oauth-protected-resource` (root and `/api/mcp`) |
| Pages | `app/[locale]/(site)/(minimal-header)/auth/connect`, `.../auth/consent` |
| Flow test | `features/account/backend/auth/customer-agent-oauth-flow.postgres.test.ts` |

## Server configuration

- Use only Better Auth's own packages: `@better-auth/mcp` (built on
  `@better-auth/oauth-provider`) and `@better-auth/cimd`, pinned to the
  `better-auth` version. The 1.6 built-in `mcp` and `oidcProvider` plugins no
  longer exist.
- Access tokens are opaque (`disableJwtPlugin: true`), stored hashed, and
  checked against their row on every MCP request. Don't add the `jwt()`
  plugin: JWT access tokens can't be revoked or cascade-deleted, its signing
  keys would live in `auth.jwks` (copied into preview branches and encrypted
  with a different secret there), and remote verification self-fetches a
  JWKS URL that Vercel Deployment Protection blocks on previews.
- Agents register only through Client ID Metadata Documents (`cimd` with
  `metadataProfile: "mcp-2026-07-28"` and the pinned Node transport).
  Dynamic client registration stays off and the client-management endpoints
  are in `disabledPaths` (`disabledCustomerAgentClientPaths`).
- Scopes: `offerings:read`, `reservations:read`, `reservations:create`, and
  `offline_access` so agents can refresh without the customer present.
  Without `offline_access`, ending the browser session revokes the grant.
- The resource is one static URL per deployment (`customerMcpResource` in
  `auth.server.ts`, resolved in `auth-hosts.ts`): the canonical host in
  production, `VERCEL_URL` on previews, `localhost:3000` in development. The
  issuer follows the request host (`<origin>/api/auth`).
- The provider seeds the resource into `auth.oauth_resource` when the
  instance starts, so every auth instance, including memory-backed test
  instances, needs the OAuth models.
- `verifyCustomerAgentAccessToken` is a `SERVER_ONLY` endpoint over the
  provider's `getOAuthProviderApi(...).validateAccessToken`, so the MCP route
  verifies in-process without an introspection client.
- Every direct `auth.api.*` call needs a request or a `host` header: with the
  dynamic `allowedHosts` base URL, Better Auth otherwise throws a 500
  `APIError` before the endpoint runs. The adapter passes the MCP resource's
  host, which every deployment trusts and which needs no Next request store.
- Classify Better Auth failures with `isProviderRejection`
  (`customer-agent-authorization.service.ts`): a 4xx `APIError` is a refusal
  (unknown token or client); a 5xx `APIError` or anything else is an outage.
- The `mcp()` resource check accepts only HTTPS, or HTTP on loopback.

## Discovery

- `/.well-known/oauth-authorization-server/api/auth` (RFC 8414,
  issuer-path insertion) and `/.well-known/oauth-protected-resource` plus
  `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728) are Next route
  handlers that pass the request to `auth.handler`. Better Auth runs plugin
  `onRequest` hooks before base-path matching, so the provider and `mcp()`
  answer from their own builders. Never hand-build the JSON. The one
  addition is `describeProtectedResource` in
  `customer-agent-authorization-server.ts`, which wraps the `mcp()`
  `onRequest` to add RFC 9728's `resource_name`, `resource_documentation`
  (`/ai-assistants`), `resource_policy_uri`, and `resource_tos_uri`, which
  the plugin can't configure. `scopes_supported` stays per resource, never
  per client.
- The MCP route answers a refused `tools/call` with the HTTP challenge and,
  in the body, a JSON-RPC error result per call whose
  `_meta["mcp/www_authenticate"]` repeats the challenge with `error` and
  `error_description`, the form ChatGPT reads for per-tool sign-in. Tools
  publish `securitySchemes` (`noauth`, or `oauth2` with the tool's scope) in
  their definition and `_meta`.
- `createResourceServerChallenge(error, resource)` points
  `resource_metadata` at `<resource origin>/.well-known/oauth-protected-resource<resource path>`.
  Pass `customerMcpResource`, not a request-derived URL, so the challenge,
  the served document, and the token audience agree.
- Dotted paths skip `proxy.ts`, so no locale redirect applies. Bun's test
  collector skips dot directories, so the route tests live beside the shared
  handler in `features/account/server`.

## App-directory clients

ChatGPT and Claude, whose directories list the MCP server, register through
their published metadata documents. The flow test signs a customer in
through each one; its fixtures in
`customer-agent-directory-clients.test-utils.ts` copy the live documents
(ChatGPT publishes no per-connector example, so that one follows its stable
document); refresh them when a client changes its document.

- ChatGPT uses `https://chatgpt.com/oauth/client.json` with redirect
  `https://chatgpt.com/connector_platform_oauth_redirect`, because the
  server advertises and sends RFC 9207 `iss`. Without that, it falls back
  to `https://chatgpt.com/oauth/{callback_id}/client.json` and
  `https://chatgpt.com/connector/oauth/{callback_id}`, which the server
  also accepts.
- ChatGPT's document declares `private_key_jwt` with a `jwks_uri` on its own
  origin, so its code exchange and refresh need a signed client assertion
  (audience the token endpoint or the issuer, at most 300 seconds, single-use
  `jti` recorded in `oauth_client_assertion`). The provider fetches the JWKS
  through the CIMD transport. Keep `private_key_jwt` in
  `token_endpoint_auth_methods_supported`.
- Claude's apps use `https://claude.ai/oauth/mcp-oauth-client-metadata` with
  redirect `https://claude.ai/api/mcp/auth_callback` and no client
  authentication. Claude picks a metadata document only when the metadata
  advertises `client_id_metadata_document_supported` and `none`; otherwise it
  falls back to dynamic registration, which is off, so dropping either breaks
  Claude.
- Claude Code uses `https://claude.ai/oauth/claude-code-client-metadata`,
  registering `http://localhost/callback` and `http://127.0.0.1/callback`,
  and listens on a port it picks per sign-in. Upstream 1.7.2 ignores the port
  only for loopback IPs; the `@better-auth/oauth-provider` patch extends that to
  `localhost` (see the `deskohub-repository` skill's patched dependencies).
  Only the port may differ: once normalized, scheme, credentials, host, path,
  query, and fragment match the registered URI exactly, for loopback IPs too.
  Errors follow the same match, so a request for any other URI gets the
  server's error page.
  A document without `application_type` gets native redirect validation,
  which allows HTTP loopback redirect URIs.
- The consent page names each client by its metadata host: `chatgpt.com`,
  `claude.ai`. Claude Code also shows `claude.ai`, though its redirect
  URI is on loopback.
- Successful and error authorization responses at the client's redirect URI
  carry `iss`, equal to the advertised issuer. A request whose client or
  redirect URI can't be trusted goes to the server's error page instead.
- The `resource` the client requests becomes the token's audience; an
  expired or unknown token gets a 401 `invalid_token` challenge.
- Directory apps see every MCP tool. Only ChatGPT gets a different
  `start_reservation`: a public, read-only variant that returns a link to
  continue the booking on the website, without sign-in or a hold.

## Connect and consent pages

- The provider redirects to the root-relative `loginPage`/`consentPage`
  with the authorize parameters plus `exp`, `ba_iat`, `ba_param`, and `sig`.
  The proxy localizes them and keeps the query.
- Both pages re-read the session through `readCustomerAgentSession`
  (signed out, signed in, deletion pending, unavailable). A deletion-pending
  account can't connect: its tokens would never authorize. Both export
  `instant = false` and call `redirect()` outside Suspense, so the redirect
  happens before streaming starts and stays an HTTP 307. Keep it that way:
  a Suspense boundary above the redirect turns it into a client redirect.
- `/auth/connect` uses `resolveCustomerAgentConnectStep` for the next step:
  signed out, or asked to sign in again (`prompt=login` or `create`,
  `max_age`), the customer goes to the existing sign-in page with the
  `assistant` purpose and a `signed_in=1` marker on the return path.
  Signed in, the page redirects to `/api/auth/oauth2/authorize` with the
  original parameters minus the signing parameters; the provider validates
  the request from scratch and continues to consent. A marked return drops
  the sign-in demands, as the provider's own post-sign-in resume does. The
  provider resumes by itself only when the request carrying `oauth_query`
  sets the session cookie, which magic-link sign-in never does, and
  `/oauth2/continue` covers only account selection, sign-up, and post-login
  pages.
- The provider always fills in `scope` (the client's defaults when the
  agent asks for none) before it signs the request, so the consent page
  lists exactly the signed scopes. Read page queries with
  `toURLSearchParams` so repeated `ba_param` values survive.
- `/auth/consent` first rejects requests that can't succeed (no `client_id`,
  `sig`, or `exp`; past `exp`), then re-checks the session, reads the client through
  `CustomerAgentClientDirectory` (`getOAuthClientPublic`, which needs the
  customer's session), and shows the client's name and metadata host, the
  requested scopes in plain words, what the assistant can't do (pay, cancel,
  change or delete the account), and that the customer accepts the terms and
  pays on the site. Don't render the client's logo: it is a third-party
  request from an arbitrary host.
- Allow and Deny call `authClient.oauth2.consent({ accept })`.
  `oauthProviderClient()` in `auth.client.ts` attaches the signed
  `oauth_query` from the page URL to non-GET auth requests. The provider
  answers `{ redirect: true, url }` for both outcomes and doesn't navigate;
  the page assigns `url`. A 400 means the signed request expired or was
  tampered with.
- Terms acceptance and legal consent evidence stay on the Pay step; the
  consent page records only the OAuth grant.

## Connected assistants

- The account's `assistants` section lists the customer's consents
  (`getOAuthConsents`), each named and hosted through
  `CustomerAgentClientDirectory`, with the granted scopes in the consent
  page's words (`describeCustomerAgentScope`) and the consent's creation
  time. Better Auth records no last-use time.
- The list needs only the session, so every signed-in state except a pending
  deletion carries it, with or without a Dotypos profile. An unreadable list
  shows an unavailable notice; a client whose metadata can't be read stays
  listed without a name, so it can still be disconnected.
- Disconnect calls `authClient.oauth2.deleteConsent({ id })` from the
  browser, as passkey deletion does; Better Auth checks the session and that
  the consent is the customer's. A consent that is already gone counts as
  disconnected. Reconnecting asks for consent again.
- Upstream Better Auth deletes only the consent row. The Workspace
  `@better-auth/oauth-provider` patch (see the `deskohub-repository` skill's
  patched dependencies) binds every access and refresh token of a client
  that asks for consent to the consent that authorized it: `consent_id` on
  both token tables references `oauth_consent` with `ON DELETE CASCADE`. The
  code exchange takes the consent the code is bound to (below) and refuses
  a code without one; a refresh carries the consent of the token it
  rotates.
- So a disconnect is one statement: it deletes every consent of the client,
  customer, and reference (a concurrent consent can record a duplicate),
  and the database deletes their tokens with them. A token can't outlive its
  consent, and no other consent, newer or recorded late, can keep it
  working. A disconnect that fails deletes nothing and keeps the assistant
  listed, so a retry still works. A refresh or code exchange that a
  disconnect overtakes can't write its tokens and answers `invalid_grant`;
  one that finishes first has its tokens deleted with the consent, so at
  most it hands out tokens that never work.
- A token of a client that asks for consent without a consent predates
  the binding. The migration binds no existing token: timestamps can't
  tell a token that outlived a disconnect from one a consent recorded in
  the same instant issued, so a backfill could revive a disconnected
  assistant. Such a token, including any the previous deployment issued
  during the release, is refused when presented (the assistant connects
  again once) and deleted then, or by the daily auth cleanup once it
  expires. Tokens of a client that skips consent reference no consent and
  keep working; deleting a consent never touches them. Guards:
  `oauth-token-consent-binding-migration.postgres.test.ts` beside the flow
  test.
- Two approvals of the assistant at once can both record a consent. One
  recorded after a disconnect leaves the assistant listed as connected
  under that approval; tokens of the disconnected consent stay revoked.
- The patch also binds each authorization code to the consent that
  authorized it, so a code issued before the disconnect and redeemed after
  it gets `invalid_grant`, even after the customer reconnects. Codes issued
  before the patch carry no consent id and get `invalid_grant` from
  assistants that ask for consent, so an authorization in flight at the
  deploy is refused once and the assistant authorizes again.

## Account-boundary adapter

- `CustomerAgentAuthorization.authorize(token)` validates the token, requires
  the configured resource in `aud`, decodes `sub` and `client_id`, re-reads
  the user, and decodes it with `decodeCustomerAccountSession`. A deleted,
  deletion-pending, or unverified account gets no grant. Unknown scopes are
  dropped.
- `customerAuthenticationForAgent(token)` provides `CustomerAuthentication`
  for agent requests; every read re-verifies the token, so checks under the
  account lock stay authoritative.
- Better Auth types never leave the adapter or the client directory.

## Revocation and retention

- OAuth rows reference `auth.user` with `ON DELETE CASCADE`, so Better Auth
  `deleteUser` removes the customer's consents and tokens; session references
  are set to null. Better Auth itself declares no cascade, and NO ACTION would
  block account deletion.
- The daily `auth-cleanup` cron deletes expired agent access tokens, expired
  refresh tokens (their access tokens cascade), and expired client-assertion
  records. Revoked tokens stay until they expire because refresh-token replay
  detection reads them. Consents and CIMD client rows have no expiry; consents
  last until the customer disconnects the assistant or deletes the account.
- Refresh tokens rotate with a 30-second reuse window
  (`customerAgentRefreshTokenReuseSeconds`, set explicitly so the retention
  settings in `privacy-and-retention.md` stay true if the provider default
  changes; the privacy notice doesn't state it). The provider stores the
  replacement token response in `rotation_replay_response` on the rotated
  row, encrypted with the Better Auth secret, and replays it (with `expires_in` recounted) for a
  matching repeat refresh until `rotation_replay_expires_at`. Truly
  concurrent refreshes still race; the loser gets `invalid_grant` without
  ending the grant. Reuse after the window deletes the client's tokens for
  the customer. The provider never clears the copy, so `auth-cleanup`
  nulls it once the window has passed; deleting the row (expiry, account
  deletion, reuse, disconnect) removes it too.
- Lifetimes: access tokens 1 hour, refresh tokens 30 days (rotated on use),
  signed authorization requests and codes 10 minutes. Replaying a used code
  fails and revokes the tokens it bought.

## Tests

- Stub CIMD fetches with `makeTestAuth({ clientMetadataTransport })`; the
  transport receives the metadata URL and returns a `Response`.
  `https://client.example/...` needs no DNS.
- The preview E2E's synthetic agent publishes its metadata document on the
  production host (`features/account/customer-agent-test-client.ts`, served
  by `app/oauth/clients/e2e-agent.json/route.ts`). The Postgres flow test
  registers that committed document, so a change that the OAuth server would
  reject fails before it deploys.
- Prove protocol behaviour in the Postgres flow test against the real
  handler; keep adapter rules in unit tests with fake authorities. Build
  memory-backed stores with `makeMemoryAuthStore()`, which includes the
  OAuth models.
- Pre-registered public clients come from `auth.api.adminCreateOAuthClient`
  with a session and a `host` header.
- The cleanup test pre-sweeps the whole database at a far-future instant.
  Locally, run it against its own database when other suites share the
  container.
