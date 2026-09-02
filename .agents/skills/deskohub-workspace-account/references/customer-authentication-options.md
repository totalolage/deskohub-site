# Customer authentication options

Research date: 2026-09-02

## Recommendation

Replace managed Neon Auth with Better Auth, embedded in the Workspace Next.js
application and backed by the existing Drizzle instance and `DATABASE_URL`.
Generate the Better Auth tables as repository-owned Drizzle schema and migrations,
preferably in an `auth` PostgreSQL schema, and keep `customer_account_links` as the
boundary between authentication identities and Dotypos customers.

This keeps each immutable Vercel preview attached to its matching Neon branch. The
Neon integration already creates a database branch for each preview and injects
the branch-specific database connection. Better Auth accepts an existing Drizzle
database instance, including PostgreSQL and Drizzle Relations v2, so it does not
need another database or service. See the [Neon preview-branch integration](https://neon.com/blog/neon-vercel-native-integration)
and [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle).

Auth.js can meet the basic feature list, but its maintainers now recommend Better
Auth for new projects and limit Auth.js work to security patches and critical
issues. SuperTokens is credible, but self-hosting requires a separate long-running
Core service with its own database connection, which is a poor fit for branch-per-
preview Vercel deployments. Do not hand-roll sessions and magic-link token logic.

## Fit summary

| Requirement | Better Auth | Auth.js | Self-hosted SuperTokens |
| --- | --- | --- | --- |
| Next.js App Router on Vercel | First-class route handler, RSC, Server Action, and Next.js 16 proxy guidance | Supported by the Next.js package, but the documented v5 install remains on the beta channel | Supported through a Next.js serverless auth route plus frontend and backend SDK initialization |
| Same app database | Yes; pass the existing Drizzle instance to the PostgreSQL adapter | Yes; pass the existing Drizzle instance to `DrizzleAdapter` | Same Neon database is possible, but only through the separate Core service's own fixed connection and pool |
| Neon preview branches | Natural fit because every deployment uses its injected `DATABASE_URL` | Natural fit for the same reason | Poor fit unless a separate Core deployment is provisioned for every preview branch |
| Magic-link email | First-party plugin and app-owned `sendMagicLink` callback | First-party email providers, including Nodemailer SMTP | Passwordless recipe with SMTP or custom delivery |
| Profile | Built-in name plus typed additional user fields | Default user fields can be extended through the adapter schema | Arbitrary JSON user metadata |
| Logout | Built-in session sign-out | Built-in `signOut` | Built-in sign-out/session revocation |
| Account deletion | First-class, opt-in deletion with fresh-session or email confirmation and lifecycle hooks | Requires app-owned orchestration; the adapter `deleteUser` method is documented as not invoked | Built-in deletion, with an access-token blacklisting caveat |
| Deterministic tests | Test-only helpers for users, sessions, headers, and Playwright cookies; deployed email still needs mailbox capture | Database seeding is possible; no comparable first-party end-to-end test helper | Backend APIs can generate/consume passwordless codes, but Core infrastructure must also be provisioned |
| Operational ownership | Library and tables inside the existing app | Library and tables inside the existing app | Library, Core service, networking, upgrades, monitoring, and database connectivity |

## Better Auth implementation posture

### Database and preview isolation

Use `@better-auth/drizzle-adapter/relations-v2` with Workspace's existing Drizzle
instance. Better Auth's current documentation explicitly supports the Drizzle v1
RC relation model used by this repository. Generate the schema, review it, and
commit it through the normal Workspace migration workflow; do not let a production
runtime mutate the schema. The core tables cover users, sessions, authentication
accounts, and verification records. See the [database schema and migration guidance](https://better-auth.com/docs/concepts/database)
and [Relations v2 adapter guidance](https://better-auth.com/docs/adapters/drizzle#drizzle-relations-v2).

This is the decisive preview-environment advantage. Auth records live in the same
Neon branch as `customer_account_links`, while the immutable Vercel preview obtains
that branch's `DATABASE_URL`. No static auth URL and no separately selected auth
database are involved.

### Next.js boundary

Mount Better Auth at `/api/auth/[...all]`. Use its server API from React Server
Components and Server Actions, passing the request headers when resolving the
session. The provider's documentation warns that a cookie-presence check in the
Next.js proxy is only an optimistic redirect and is not an authorization check;
retain the existing authoritative session check in each protected page and action.
See the [Next.js integration](https://better-auth.com/docs/integrations/next).

Use Better Auth's dynamic `baseURL` with an explicit allowlist for production,
local development, and the intended Vercel preview-host pattern. Unknown hosts
should fail closed without a fallback. This is documented specifically for Vercel
previews and prevents arbitrary forwarded hosts from controlling magic-link
callbacks. See [Dynamic Base URL](https://better-auth.com/docs/guides/dynamic-base-url)
and the [security reference](https://better-auth.com/docs/reference/security).

Do not disable CSRF or origin checks. Better Auth validates origins, uses Fetch
Metadata for first-login protection, defaults session cookies to `HttpOnly`,
`Secure` on HTTPS, and `SameSite=Lax`, and applies built-in rate limits. Production
configuration still needs a high-entropy secret of at least 32 characters and a
documented rotation procedure.

### Magic links and SMTP

Enable only the magic-link plugin for initial authentication. It signs up a new
user automatically unless `disableSignUp` is set, defaults links to a five-minute
expiry, and atomically consumes a link on its first verification attempt. Set
`storeToken: "hashed"`; the current default is plaintext. Keep verification data
in Postgres so atomic consumption works across Vercel instances. See the
[magic-link plugin](https://better-auth.com/docs/plugins/magic-link).

Better Auth owns token creation and verification but deliberately delegates email
delivery to `sendMagicLink`. The current repository email package supports Resend
and console delivery, not generic SMTP. If the intended mail server is SMTP, add a
server-only SMTP transport to the shared email capability or use the SMTP vendor's
supported API. SMTP credentials entered in the Neon dashboard are not application
configuration and will not become available after Neon Auth is removed; configure
the required secrets separately in Vercel.

The outward response for a magic-link request should not reveal whether the email
already has an account. Log only fixed failure codes and never the email, token, or
complete link.

### Profile and reservation ownership

Better Auth's base user already has `id`, `name`, `email`, and `emailVerified`, so
the requested bare profile needs no custom auth fields. Keep verified email
read-only because it is used only to make the initial exact-email match to a
Dotypos customer. Better Auth supports typed `additionalFields`, but they are not
needed now; future server-owned fields must use `input: false`. See
[user management](https://better-auth.com/docs/concepts/users-accounts) and
[typed additional fields](https://better-auth.com/docs/concepts/typescript#additional-fields).

Continue resolving current and past reservations through the stable auth user ID
in `customer_account_links`; never join reservations by email on every request.
An existing link remains authoritative, while the verified email is only the
one-time claim input. The current `CustomerAccountResolver` boundary should remain
provider-independent.

Because the Better Auth tables become application-owned, a foreign key from
`customer_account_links.customer_account_id` to the auth user may now be viable.
If adopted, use deletion behavior that removes only the link. Dotypos reservations,
payments, invoices, and retained legal records must not cascade from auth deletion.

### Logout, sessions, and deletion

Use database-backed sessions. Leave `session.cookieCache` disabled initially so
logout and deletion invalidate access immediately. Better Auth documents that,
when cookie caching is enabled, a revoked session can remain accepted on another
device until the cache expires. Sensitive operations should always force database
validation. See [session management](https://better-auth.com/docs/concepts/session-management).

Enable `user.deleteUser` explicitly; it is off by default. Use a short fresh-session
window or Better Auth's email-confirmation deletion flow, preserve the UI's explicit
confirmation, and keep the local link cleanup synchronized with identity deletion.
Better Auth exposes `beforeDelete` and `afterDelete` hooks, but those hooks do not
replace the existing app-owned concurrency contract. Preserve the advisory lock,
authoritative session recheck, and provider-independent deletion tests. See
[Delete User](https://better-auth.com/docs/concepts/users-accounts#delete-user).

## End-to-end testing requirement

Use three complementary layers:

1. Keep provider-independent database tests for account-link convergence, two
   users claiming one Dotypos customer, and deletion racing link resolution.
2. Use a separate, test-only Better Auth instance with `testUtils()` for focused
   auth integration tests and session setup. The official guidance says not to
   include these privileged helpers in the production auth configuration. See
   [Better Auth Test Utils](https://better-auth.com/docs/plugins/test-utils).
3. Run the complete browser lifecycle against the exact pushed SHA's protected,
   immutable Vercel preview and its migrated Neon branch: anonymous protection,
   invalid email, sign-up, current history, profile update, logout, returning
   login, past history, confirmation-gated deletion, revoked access, link cleanup,
   and fresh sign-up after deletion.

The deployed lifecycle must retrieve the real message from a dedicated synthetic
mailbox through the SMTP provider's test or message API. Capturing the verification
row directly from Postgres would exercise token verification but bypass email
delivery, so it is not full magic-link E2E coverage. If the selected SMTP service
has no deterministic message-retrieval API, either add a test mailbox service or
make SMTP delivery a separate integration check and state that limitation. Do not
ship `testUtils`, a token-reading endpoint, or a browser-controlled delivery bypass
in the production preview artifact.

Direct database access remains appropriate for synthetic setup, assertions, and
cleanup. Delete only the synthetic users and links created by the run, and register
email addresses, tokens, session cookies, and URLs containing tokens with the E2E
redactor.

## Why Auth.js is not the first choice

Auth.js does support the App Router, SMTP magic links, database sessions, logout,
and the existing Drizzle database. Its Drizzle adapter accepts an existing `db`
instance and requires a verification-token table for magic links. See the
[Drizzle adapter](https://authjs.dev/getting-started/adapters/drizzle) and
[email provider](https://authjs.dev/getting-started/authentication/email).

The drawbacks are product direction and missing deletion workflow. The official
Next.js installation still uses `next-auth@beta`. The Auth.js maintainers state
that existing projects will receive security patches and critical fixes but
strongly recommend Better Auth for new projects. Its adapter interface contains
`deleteUser`, but the reference says the method is not currently invoked, so the
application must implement reauthentication, transactional cleanup, deletion,
and session invalidation itself. See the [official migration recommendation](https://authjs.dev/getting-started/migrate-to-better-auth),
[Next.js installation](https://authjs.dev/getting-started/installation?framework=Next.js),
and [adapter deletion contract](https://authjs.dev/reference/core/adapters#deleteuser).

Auth.js has the longer production history, which reduces novelty risk. That does
not outweigh adopting a beta major line whose own maintainers direct new work to
Better Auth.

## Why SuperTokens is not the first choice

SuperTokens supports Next.js App Router, passwordless magic links, SMTP delivery,
metadata profiles, session revocation, and deletion. It is a credible choice when
the team wants a separately operated identity service. See its
[Next.js App Router integration](https://supertokens.com/docs/quickstart/integrations/nextjs/app-directory/about),
[passwordless recipe](https://supertokens.com/docs/authentication/passwordless/introduction),
and [email delivery options](https://supertokens.com/docs/platform-configuration/email-delivery).

Self-hosting, however, requires a trusted SuperTokens Core service on a VM or
container plus PostgreSQL. The Core must be private or API-key protected and uses
its own `POSTGRESQL_CONNECTION_URI`. It may put tables in the same physical Neon
database, but it cannot reuse the Workspace process's Drizzle connection. See
[Self-host SuperTokens](https://supertokens.com/docs/deployment/self-host-supertokens).

A singleton Core points at one database and therefore cannot transparently follow
the branch-specific `DATABASE_URL` of each Vercel preview. Full isolation would
require one Core deployment and configuration per preview, plus teardown,
monitoring, upgrades, and private connectivity. Sharing one Core across previews
would reintroduce the cross-preview auth state the replacement is meant to avoid.

Deletion also needs careful configuration: SuperTokens warns that without access-
token blacklisting, a deleted user's active access token can continue to verify
until it expires. See its [user deletion guidance](https://supertokens.com/docs/post-authentication/user-management/common-actions#delete-user).

## Excluded options

- A custom auth implementation is not a reasonable barebones alternative. It
  would make this team responsible for token entropy and hashing, atomic one-time
  consumption, expiration, enumeration resistance, session rotation and
  revocation, secure cookies, CSRF, rate limiting, and account-deletion races.
- Lucia is not a candidate because its official site says the package was
  deprecated in March 2025. See [Lucia](https://lucia-auth.com/).
- Managed identity products may be operationally sound, but they do not satisfy
  the requirement to keep branch-isolated authentication in the existing Neon
  application database without a separate auth datastore.

## Maintenance and security tradeoffs

Better Auth is comparatively young: its first release was in September 2024 and
1.0 followed in November 2024. It is now at 1.7.2 and joined Vercel in July 2026,
which improves resourcing but does not erase the risks of a fast-moving library.
See the [project history and Vercel announcement](https://better-auth.com/blog/better-auth-joins-vercel).

Treat authentication dependencies as actively maintained security infrastructure:
pin versions, subscribe to advisories, run dependency audits, and schedule prompt
patch upgrades. Better Auth published multiple high and critical advisories in
2026 and gave package-specific upgrade paths, demonstrating both real security
surface and active response. See the [June 2026 security update](https://better-auth.com/blog/security-update-june-2026).

Auth.js is older and more battle-tested, but its forward development has moved to
Better Auth. SuperTokens moves more responsibility from library upgrades to
service operations. Better Auth therefore offers the best balance for Workspace:
the same database and preview model, first-party magic links and deletion, no new
long-running service, and a smaller migration from the current account feature.
