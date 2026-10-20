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
- The `mcp()` resource check accepts only HTTPS, or HTTP on loopback.

## Discovery

- `/.well-known/oauth-authorization-server/api/auth` (RFC 8414,
  issuer-path insertion) and `/.well-known/oauth-protected-resource` plus
  `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728) are Next route
  handlers that pass the request to `auth.handler`. Better Auth runs plugin
  `onRequest` hooks before base-path matching, so the provider and `mcp()`
  answer from their own builders. Never hand-build the JSON.
- `createResourceServerChallenge(error, resource)` points
  `resource_metadata` at `<resource origin>/.well-known/oauth-protected-resource<resource path>`.
  Pass `customerMcpResource`, not a request-derived URL, so the challenge,
  the served document, and the token audience agree.
- Dotted paths skip `proxy.ts`, so no locale redirect applies. Bun's test
  collector skips dot directories, so the route tests live beside the shared
  handler in `features/account/server`.

## Connect and consent pages

- The provider redirects to the root-relative `loginPage`/`consentPage`
  with the authorize parameters plus `exp`, `ba_iat`, `ba_param`, and `sig`.
  The proxy localizes them and keeps the query.
- `/auth/connect` re-checks the session. `resolveCustomerAgentConnectStep`
  decides the next step: signed out, or asked to sign in again (`prompt=login`
  or `create`, `max_age`), the customer goes to the existing sign-in page with
  the assistant purpose and a `signed_in=1` marker on the return path.
  Signed in, the page redirects to `/api/auth/oauth2/authorize` with the
  original parameters minus the signing parameters; the provider validates
  the request from scratch and continues to consent. A marked return drops
  the sign-in demands, as the provider's own post-sign-in resume does. The
  provider resumes by itself only when the request carrying `oauth_query`
  sets the session cookie, which magic-link sign-in never does, and
  `/oauth2/continue` covers only account selection, sign-up, and post-login
  pages.
- `/auth/consent` re-checks the session, reads the client through
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
  last until account deletion.
- Lifetimes: access tokens 1 hour, refresh tokens 30 days (rotated on use),
  signed authorization requests and codes 10 minutes.

## Tests

- Stub CIMD fetches with `makeTestAuth({ clientMetadataTransport })`; the
  transport receives the metadata URL and returns a `Response`.
  `https://client.example/...` needs no DNS.
- Prove protocol behaviour in the Postgres flow test against the real
  handler; keep adapter rules in unit tests with fake authorities.
- The cleanup test pre-sweeps the whole database at a far-future instant.
  Locally, run it against its own database when other suites share the
  container.
