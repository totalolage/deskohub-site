# Better Auth integration and security constraints

Research date: 2026-09-02

This note resolves the research question in
[Research Better Auth integration and security constraints](https://github.com/totalolage/deskohub-site/issues/342).
It records current primary-source facts and the viable implementation choices;
it does not implement the integration.

## Executive finding

Better Auth 1.7.2 supports the Workspace dependency range: Next.js 16,
React 19, `pg` 8, and Drizzle ORM 1.0 RC. Its Next.js handler, magic-link
plugin, database sessions, deletion workflow, dynamic preview URLs, and
database rate limiter cover the required surface.

One local integration constraint needs an explicit design decision. Workspace's
application database is a Drizzle `EffectPgDatabase`, whose query builders
produce Effects. Better Auth's Drizzle adapter is written for ordinary
promise-returning Drizzle databases and awaits their builders. Passing the
existing Effect database object directly is therefore not an established
compatible path. Two supported alternatives remain:

1. construct a small `drizzle-orm/node-postgres` database wrapper for Better
   Auth over Workspace's existing module-level `pg.Pool`, then use
   `@better-auth/drizzle-adapter/relations-v2`; or
2. pass that existing `pg.Pool` directly to Better Auth's built-in PostgreSQL
   adapter.

The first choice retains repository-owned Drizzle schema generation and the
normal Drizzle migration workflow. The second has the smallest runtime adapter
surface, but Better Auth rather than Drizzle generates/manages its SQL schema.
Neither choice requires another database or another connection pool.

## Version and stack compatibility

- Better Auth's current stable release is
  [1.7.2](https://github.com/better-auth/better-auth/releases/tag/v1.7.2),
  released 2026-08-26. Its package peer range includes Next.js 14–16, React
  18–19, `pg ^8`, and `drizzle-orm >=1.0.0-rc.1 <2.0.0`. Workspace currently
  uses Next.js 16.3, React 19.2, `pg` 8.21, and Drizzle 1.0.0-rc.4 in
  [`apps/deskohub-workspace/package.json`](../../../../../apps/deskohub-workspace/package.json).
- Relations v2 is a separate export in the matching
  `@better-auth/drizzle-adapter` 1.7.2 package. The official
  [Drizzle adapter guide](https://better-auth.com/docs/adapters/drizzle#drizzle-relations-v2)
  says to import `@better-auth/drizzle-adapter/relations-v2`, pass the schema,
  and merge the generated `authRelations` after the application's full
  relations.
- Pin `better-auth` and `@better-auth/drizzle-adapter` to the same exact stable
  version rather than a caret range. Better Auth ships coordinated scoped
  packages and has published several security fixes. Its
  [June 2026 security update](https://better-auth.com/blog/security-update-june-2026)
  explicitly tells consumers to update every installed Better Auth package and
  watch the advisory feed. The magic-link pre-account-hijacking advisory is
  patched from 1.6.22 and 1.7.0-beta.10 onward; 1.7.2 is outside the affected
  range. See
  [GHSA-qq9h-g4jm-xgf3](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3).

## Database and pool choices

Workspace creates one module-level `pg.Pool`, registers it with Vercel, and
uses it to build the Effect Drizzle client in
[`database-provider.server.ts`](../../../../../apps/deskohub-workspace/db/database-provider.server.ts)
and
[`database-client.ts`](../../../../../apps/deskohub-workspace/db/database-client.ts).
Keeping that pool as the only connection owner preserves the established
serverless lifecycle.

### Standard Drizzle wrapper over the shared pool

The official adapter accepts an already-created Drizzle database. Relations v2
supports `provider: "pg"`, an explicit schema, and an optional PostgreSQL
`schemaName`; it generates relation definitions compatible with Drizzle 1.0.
See the
[Drizzle example and schema workflow](https://better-auth.com/docs/adapters/drizzle)
and
[Relations v2 section](https://better-auth.com/docs/adapters/drizzle#drizzle-relations-v2).

The viable Workspace shape is a standard node-postgres Drizzle wrapper created
over the existing Pool solely for Better Auth. A Drizzle wrapper is not a
second database connection or pool. This lets Better Auth receive the ordinary
promise-based interface its adapter awaits while the application continues to
use its Effect client.

Directly passing `EffectPgDatabase` is not documented by either project. The
inference that it is unsafe is supported by Workspace's Effect-returning
factory above and Better Auth's
[Drizzle adapter source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/drizzle-adapter/src/relations-v2/index.ts),
which awaits ordinary Drizzle builders.

### Built-in PostgreSQL adapter over the shared pool

Better Auth also officially accepts an existing node-postgres `Pool`; see the
[PostgreSQL adapter](https://better-auth.com/docs/adapters/postgresql). This is
a supported runtime choice over the same Workspace pool. It bypasses the
Drizzle adapter, so the later schema-ownership decision must reconcile Better
Auth's SQL migration tooling with this repository's rule that Drizzle tooling
generates migration SQL, journals, and snapshots.

### Transactions and pool ownership

The Drizzle adapter has an optional `transaction` setting; it defaults to
false. Better Auth's own adapter transactions do not automatically include
Workspace operations such as deleting `customer_account_links`. The existing
account deletion lock and compensating unlink contract therefore cannot be
replaced merely by enabling adapter transactions.

Better Auth receives a database or pool owned by its caller; its documented
configuration has no lifecycle callback that closes a supplied pool. The
application must continue to own Vercel registration and lifecycle. Creating a
second Pool would be unnecessary.

## Schema generation and migrations

- With a Drizzle adapter, `auth generate` produces an ORM schema, then
  `drizzle-kit generate` produces the migration. Better Auth's `migrate` and
  programmatic `getMigrations` apply only to its built-in Kysely adapters. See
  [Database CLI guidance](https://better-auth.com/docs/concepts/database#cli)
  and the
  [Drizzle migration commands](https://better-auth.com/docs/adapters/drizzle#schema-generation--migration).
- The generated schema must include the plugins and options enabled in the real
  auth configuration. Magic link uses the core verification table; database
  rate limiting adds the `rateLimit` table.
- A PostgreSQL `schemaName` such as `auth` is supported by the Relations v2
  adapter. The generated schema must be reviewed before Drizzle generation,
  and the resulting SQL, journal, and snapshot must follow Workspace's normal
  migration/release process rather than runtime migration. See
  [custom schema namespaces](https://better-auth.com/docs/adapters/drizzle#custom-schema-namespace)
  and the repository's
  [`database-and-releases.md`](../../deskohub-workspace-operations/references/database-and-releases.md).
- Generated code is an input to review, not an authority over application table
  ownership. In particular, foreign keys or deletion cascades involving
  `customer_account_links` remain an application/domain decision.

## Next.js 16 boundary

- Mount `toNextJsHandler(auth)` as `GET` and `POST` in
  `/api/auth/[...all]/route.ts`. Server Components and Server Actions call
  `auth.api` with `await headers()`. These are the official patterns in the
  [Next.js integration](https://better-auth.com/docs/integrations/next).
- `nextCookies()` is needed only when an `auth.api` call that emits
  `Set-Cookie` is made from a Server Action, and Better Auth requires it to be
  the last plugin. Calls through the client and mounted route handler do not
  justify adding it speculatively.
- A proxy cookie-presence check is explicitly not an authorization check.
  Protected pages, route handlers, and mutations must validate the
  authoritative session. Workspace's current page/action rechecks should be
  retained.
- React Server Components cannot refresh cookies. If sliding session refresh
  is desired, it occurs only when a client request, Route Handler, or Server
  Action can write cookies.

## Preview URL, origins, and cookies

- Better Auth 1.7 supports an object-form dynamic `baseURL` with
  `allowedHosts`; the guide explicitly covers Vercel previews. Unknown hosts
  throw unless a fallback is configured. Allowed hosts are automatically
  trusted origins. See
  [Dynamic Base URL](https://better-auth.com/docs/guides/dynamic-base-url)
  and the
  [`baseURL` reference](https://better-auth.com/docs/reference/options#baseurl).
- Use an allowlist limited to the production hosts, the actual Vercel preview
  host pattern, and local development. Do not infer arbitrary request hosts and
  do not add a production fallback that hides an unknown preview host.
- Forwarded host/protocol headers are ignored unless
  `advanced.trustedProxyHeaders` is enabled. Enabling that option is a separate
  trust decision and unnecessary when dynamic `allowedHosts` can validate the
  host directly.
- Better Auth's session cookies are `HttpOnly`, `SameSite=Lax`, and Secure on
  HTTPS/production by default. Cross-subdomain cookies are disabled by default;
  this product does not need them. See the
  [security reference](https://better-auth.com/docs/reference/security#cookies).
- Leave both `disableCSRFCheck` and `disableOriginCheck` false. Better Auth
  validates origins and callback/redirect URLs, uses non-simple mutations where
  possible, and applies Fetch Metadata protection to first-login browser
  requests. Disabling origin checking also disables CSRF checking for backward
  compatibility. See
  [CSRF protection](https://better-auth.com/docs/reference/security#csrf-protection).

## Magic-link verification storage

- The magic-link plugin signs in and implicitly creates a user unless
  `disableSignUp` is true. Its default expiry is five minutes.
- Tokens are atomically consumed on the first verification attempt. Keeping
  verification records in PostgreSQL gives that guarantee across Vercel
  instances without adding secondary storage.
- `storeToken` defaults to plaintext. Set it explicitly to `"hashed"`; the
  email still contains the bearer URL, but a database reader cannot redeem the
  stored value directly. See the
  [magic-link configuration](https://better-auth.com/docs/plugins/magic-link#configuration-options).
- Do not configure secondary verification storage. If introduced later, its
  `getAndDelete` operation must be atomic; Better Auth requires this for
  multi-instance single-use semantics.
- `sendMagicLink` receives the email address, raw token, and bearer URL. Those
  values must stay out of application logs, traces, errors, and provider
  metadata. Delivery is addressed separately in the issue 343 artifact.

## Sessions, logout, and deletion

- Better Auth uses database sessions by default when a database is configured.
  Defaults are seven-day expiry, one-day sliding refresh, and one-day freshness.
  Cookie session caching is off by default. See
  [Session Management](https://better-auth.com/docs/concepts/session-management).
- Leave cookie caching disabled initially. It adds a signed cached session
  cookie and weakens immediate revocation until the cache expires. Database
  validation makes logout and account deletion observable immediately.
- `user.deleteUser` is hard deletion and disabled by default. Enabling it still
  requires the signed-in user plus a password, a fresh session, or configured
  deletion-email verification. A magic-link-only account has no password, so
  the product must retain a nonzero fresh-session window or add a second
  deletion magic link. See
  [Delete User](https://better-auth.com/docs/concepts/users-accounts#delete-user).
- Better Auth exposes `beforeDelete` and `afterDelete`, but those callbacks do
  not make external Workspace link operations part of the same transaction.
  Preserve explicit confirmation, the per-account advisory lock, authoritative
  session recheck, link cleanup, and provider-independent deletion-race tests.

## Rate limiting and logging

- Built-in rate limiting is enabled by default only in production and uses
  process memory by default. Memory is not a deployment-wide limiter on Vercel.
  Configure `enabled: true` and `storage: "database"`, include its generated
  table, and set an explicit stricter rule for `/sign-in/magic-link`. See
  [Rate Limit](https://better-auth.com/docs/concepts/rate-limit).
- Better Auth's current concept guide states a 60-second default window while
  the options reference states 10 seconds. Avoid depending on this documented
  inconsistency: set the window and maximum explicitly and test the selected
  behavior.
- Server-side `auth.api` calls are not subject to the client rate limiter.
  Browser sign-in should use the client/mounted endpoint rather than a custom
  unrestricted Server Action unless the application supplies equivalent
  limiting.
- Better Auth's default log level is `warn`; custom error hooks can receive
  arbitrary error objects. Route all auth reporting through the Workspace
  fixed-code/redaction boundary and never attach request bodies, emails,
  cookies, tokens, or callback URLs.

## Secrets and dependency maintenance

- Production throws when neither `BETTER_AUTH_SECRET` nor `AUTH_SECRET` is
  configured. The official generator is `openssl rand -base64 32`. Keep auth
  secrets server-only and stable across deployments in the same environment.
- Versioned `BETTER_AUTH_SECRETS` supports non-destructive rotation: the first
  key encrypts new data and older keys decrypt existing envelopes. See
  [secret rotation options](https://better-auth.com/docs/reference/options#secrets).
- A shared secret across preview deployments preserves cloned sessions, while
  per-preview secrets invalidate cloned encrypted/signed material. Which
  isolation behavior is wanted must be decided explicitly; no secret may be
  derived from a public deployment identifier.
- Add Better Auth and every installed scoped package to dependency monitoring,
  audit the lockfile, and treat published auth advisories as patch triggers.

## Test utilities

The official [`testUtils`](https://better-auth.com/docs/plugins/test-utils)
plugin can create/delete users, create authenticated sessions, return headers,
and return Playwright cookies. It also captures OTPs, but does not capture
magic-link URLs. Better Auth recommends a separate test-only auth instance and
keeping these privileged helpers out of production configuration.

Use those helpers only for focused integration tests. Injecting a session or
reading a verification row cannot replace the required exact-preview lifecycle,
which must exercise the deployed magic-link request, real delivery callback,
verification, cookie creation, logout, and deletion paths.

## Decisions enabled by these facts

Later planning can now choose:

1. standard node-postgres Drizzle wrapper over the shared Pool versus Better
   Auth's built-in Pool adapter;
2. public versus dedicated `auth` PostgreSQL schema and exact table naming;
3. explicit session expiry, refresh, and freshness windows;
4. shared versus per-preview versioned secret policy; and
5. exact database rate limits for magic-link requests.

No external auth database, Redis layer, cookie cache, cross-subdomain cookie,
or production test-utils plugin is required for the requested product.
