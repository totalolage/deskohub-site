# Administrator role storage: Better Auth options

Research for [#619](https://github.com/totalolage/deskohub-site/issues/619) (map [#618](https://github.com/totalolage/deskohub-site/issues/618)). Baseline: `origin/main` at `b98360e68`, `better-auth@1.7.2`.

Sources:

- Better Auth 1.7.2 installed package (`better-auth@1.7.2`, `dist/`). Line links below go to the matching upstream tag `v1.7.2`.
- Official docs: [admin plugin](https://better-auth.com/docs/plugins/admin), [database / extending core schema](https://better-auth.com/docs/concepts/database#extending-core-schema), [session caching](https://better-auth.com/docs/concepts/session-management#session-caching). The docs site currently describes v1.7.10. Where docs and the 1.7.2 source disagree, the source wins.
- Repository code paths are relative to `apps/deskohub-workspace/` unless noted.

## Current state

- **Better Auth config.** Plugins are `magicLink`, `emailOTP`, and `nextCookies`. Sessions are database-backed: 30-day expiry, daily refresh, 10-minute `freshAge`, and `cookieCache.enabled: false`. The user and session load in one joined query (`advanced.database.joins: true`). `user.additionalFields` holds `deletionRequestedAt` and `locale`, both `input: false` (`features/account/backend/auth/auth-options.ts:10-16, 76-90, 121-126`). The adapter uses schema `auth` with no `usePlural` and no field mapping (`features/account/backend/auth/auth-server.ts:787`).
- **Tables.** `auth.user` has no role column (`db/schema/auth.ts:21`). There is a precedent for a public-schema table keyed by `auth.user.id` with `onDelete: "cascade"`: `db/schema/customer-account-links.ts:11`.
- **Session reads.** `CustomerAuthentication` calls `auth.api.getSession({ query: { disableRefresh: true }, headers })` (`features/account/backend/customer-authentication.service.ts:255`). `proxy.ts` only checks that a session cookie exists (`getSessionCookie`, `proxy.ts:106`). It never resolves a session.
- **`/admin` gate.** `proxy.ts:121-144` checks HTTP Basic credentials against `ADMIN_BASIC_AUTH_CREDENTIALS`: newline-separated `username:sha256` entries (`shared/administrator/administrator-credentials.ts:75`). Every admin page loader and server action also calls `authorizeAdministratorPage` / `requireAdministratorAuthorization` (`shared/administrator/administrator-authorization.server.ts:18`).
- **CLI sessions.** `/admin/cli/authenticate` records the Basic username as `approved_by` (`features/admin-cli/page-data.server.ts:29`, `cli-authentication.service.ts:269`). The grant exchange and every `authenticateSession` call reject a session whose `approved_by` is no longer in the registry (`cli-authentication.service.ts:333, 415-418`). The same username is stored as the actor on invoice provenance and standalone access-code attempts (`features/accounting/admin/actions.ts:27`, `features/access-codes/admin/actions.ts:19`, `features/admin-cli/workspace-admin-api.server.ts:424`).
- **Migrations.** Drizzle generates from `db/schema/index.ts` and `db/schema/auth.ts` into `db/migrations` (`drizzle.config.ts:17`). Preview CI migrates the Ready preview branch before E2E, not during the Vercel build (`.github/workflows/workspace-e2e.yml:437`). Precedent for an auth column: `20261013062101_customer_locale_preference` added `auth.user.locale`.

### Prior decisions (#389, #339)

- [#390](https://github.com/totalolage/deskohub-site/issues/390#issuecomment-5538697557): distinct administrator identities with equal access. Basic auth stayed for that release. Roles beyond a single "administrator" and a broad audit ledger were out of scope.
- [#391](https://github.com/totalolage/deskohub-site/issues/391#issuecomment-5539252577): an environment-managed registry, provisioned and revoked by redeploying. This chose against an admin-management UI or a DB credential store. It does **not** reject DB-stored Better Auth roles.
- [#393](https://github.com/totalolage/deskohub-site/issues/393#issuecomment-5539418793): CLI sessions belong to the exact approver. Removing an administrator invalidates that administrator's CLI sessions on the next authenticated request. Keep this behavior.
- [#394](https://github.com/totalolage/deskohub-site/issues/394#issuecomment-5539419149): previews use **synthetic** admin credentials, so production administrators cannot open preview `/admin` today.
- [#339](https://github.com/totalolage/deskohub-site/issues/339#issuecomment-5523201557): Better Auth lives on the branch-specific Neon database. Roles were out of scope; neither the admin plugin nor DB roles were rejected.

## Option A: Better Auth `admin` plugin

**Fields.** On `user`: `role` (string), `banned` (boolean, default `false`), `banReason`, `banExpires`. On `session`: `impersonatedBy`. All are `input: false` ([schema.ts](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/admin/schema.ts#L1-L36)). Defaults: `defaultRole: "user"`, `adminRoles: ["admin"]`, `adminUserIds: []` ([admin.ts:38-49](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/admin/admin.ts#L38-L49)). A user-create hook writes `role = defaultRole` on every new user. A session-create hook rejects banned users ([admin.ts:72-117](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/admin/admin.ts#L72)).

**Endpoints.** The plugin mounts 15 routes under the auth base path: `/admin/set-role`, `get-user`, `create-user`, `update-user`, `list-users`, `list-user-sessions`, `ban-user`, `unban-user`, `impersonate-user`, `stop-impersonating`, `revoke-user-session`, `revoke-user-sessions`, `remove-user`, `set-user-password`, `has-permission` ([admin.ts:141-159](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/admin/admin.ts#L141-L159)).

**Disabling endpoints.** The plugin has no per-endpoint switch. The core option `disabledPaths` is checked in the router's `onRequest` after plugin endpoints are merged, and a match returns 404 (`dist/api/index.mjs:163-166`). So it does cover plugin paths, but only for HTTP requests. Server calls such as `auth.api.impersonateUser(...)` skip the router and stay callable. To expose nothing, all 15 paths would have to be listed, and the list kept in sync on every upgrade.

**Access control.** Roles come from `createAccessControl(statements).newRole(...)`. `hasPermission` splits the comma-separated `role`, falls back to `defaultRole`, and passes if any role authorizes. `adminUserIds` bypasses the check entirely ([has-permission.ts](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/admin/has-permission.ts#L6-L28)). In 1.7.2, `hasPermission` never reads `adminRoles`, although the `AdminOptions` comment says it does. The **default `admin` role** grants `user: create, list, set-role, ban, impersonate, delete, set-password, set-email, get, update` and `session: list, revoke, delete` (`dist/plugins/admin/access/statement.mjs`). Out of the box, any administrator can call `POST /api/auth/admin/set-role` from a browser to promote or demote any account. `create-user` skips the permission check when called with no session and no headers (`dist/plugins/admin/routes.mjs`, the `createUser` handler).

**Role in `getSession` and the cookie cache.** `getSession` passes the user through `parseUserOutput`, so `session.user.role` is present, and it reaches the browser through the session endpoint as well. When the cookie cache is on, it stores `{ session, user }`, including `role`, for `maxAge` (default 5 minutes). `query.disableCookieCache: true` skips the cache ([session.ts](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/session.ts#L232-L254), [cookies/index.ts:150-184](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/cookies/index.ts#L150-L184)). Workspace has the cache disabled, so today the role would always be read fresh from the DB.

**Impersonation risk.** `POST /admin/impersonate-user` needs a session and `user:impersonate`, which the default `admin` role has. Impersonating another admin also needs `user:impersonate-admins` or the deprecated `allowImpersonatingAdmins`. The impersonation session lasts one hour by default. `adminUserIds` bypasses all of these checks ([routes.ts:1126-1244](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/admin/routes.ts#L1126-L1244)). Removing the risk takes a custom role without `impersonate`, plus a `disabledPaths` entry as a second layer. Impersonation would let an administrator act as a customer in Workspace, including their reservations and account deletion, which no Workspace requirement asks for.

**Grant and revoke.** `auth.api.setRole` requires headers from an admin session (`adminMiddleware` → `getAuthoritativeSessionFromCtx`), so the first grant must be written directly in SQL. Revoking means setting the role to `user`. `setRole` does **not** revoke sessions. `banUser` and `removeUser` do call `deleteUserSessions` (`dist/plugins/admin/routes.mjs:540, 781`).

**Migration.** One Drizzle migration adds four `auth.user` columns and one `auth.session` column. The create hook also backfills `role = 'user'` onto every new customer row. `banned`, ban expiry, and `impersonatedBy` become columns that no Workspace feature reads.

**Fit.** Poor. It adds a second admin API surface alongside the Workspace admin UI, CLI, and API, against the administration skill's "one shared service per operation" rule. Its permission model is centered on user management, not on Workspace operations, and it needs endpoint suppression to be safe.

## Option B: `role` additional field on `auth.user`

**Shape.** Add `user.additionalFields.role` (or a narrower `administrator` boolean) with `input: false`, alongside `deletionRequestedAt` and `locale`, plus a `CHECK` constraint on allowed values like the one on `locale`. In 1.7.2, `input: false` makes sign-up and `/update-user` reject the field with `FIELD_NOT_ALLOWED`, and provider-profile mapping drops it (`dist/db/schema.mjs:59-76, 116-126`). Customers cannot promote themselves. Set `returned: false` to keep it out of client session payloads. Server code can still read it from the DB.

**Role in `getSession`.** With `returned` left at its default (true), `session.user.role` arrives in the existing joined session query at no extra cost. The admin menu entry ([#628](https://github.com/totalolage/deskohub-site/issues/628)) can render from the session already loaded. The cookie-cache behavior matches Option A: always fresh today, but up to `maxAge` stale if the cache is ever enabled, unless admin guards pass `disableCookieCache: true`.

**Grant and revoke.** A Workspace-owned service runs `UPDATE auth.user SET role = …`. Better Auth exposes no endpoint for it, so the service lives in the administration feature and is reachable from the admin UI and the CLI per the shared-service rule. The column stores no provenance (who granted, when). A record would need an audit event, which #390 kept out of scope.

**Revocation effects.**

- Browser sessions: the cookie cache is off and admin guards read the session from the DB, so a revoked administrator loses access on the next request. Their customer session stays valid.
- CLI sessions: replace `administrators.hasUsername(approvedBy)` with "user `approved_by` still has the role". That keeps #393's next-request invalidation. `approved_by` must change from a Basic username to a user id ([#625](https://github.com/totalolage/deskohub-site/issues/625)).

**Migration.** Small: one nullable column with a `CHECK` constraint, a matching `additionalFields` entry, and a seed grant. Precedent: `customer_locale_preference`. The account skill requires auth options and schema to stay in sync, and `db/schema/auth.test.ts` enforces it.

**Fit.** Good. It matches the requested "stored role on the customer account", reuses Better Auth's field and session machinery, and mounts no new endpoints.

## Option C: administrator-grant table keyed by user id

**Shape.** A Workspace table in the public schema, for example `administrator_grants (user_id PK → auth.user.id ON DELETE CASCADE, granted_by, granted_at, revoked_at?)`, following `customer_account_links`. Better Auth knows nothing about it.

**Role in `getSession`.** The grant does not appear in `getSession`. Each admin check needs its own query, or an adapter-level join Better Auth does not offer for foreign tables. The admin menu entry needs that same lookup on customer pages. The cookie cache has no effect on the grant, so revocation stays immediate even if the cache is later enabled.

**Grant and revoke.** Insert, or delete or set `revoked_at`, through a Workspace service. Provenance (who and when) lives in the row itself. Deleting the account cascades the grant away.

**Revocation effects.** Same as B: the next browser request and the next CLI request fail once guards check the table.

**Migration.** Small: one new table and an FK into `auth.user`. Drizzle generates it from `db/schema/index.ts`. The auth schema and `auth-options.ts` stay as they are.

**Fit.** Good. It keeps authorization data owned by the administration domain, records provenance, and couples nothing to Better Auth. The cost is one extra query per admin check and per menu render.

## Preview Neon branches (all options)

Neon preview branches copy production at fork. Inherited Better Auth rows are allowed, and the repository forbids a scrubber or an alternate parent branch (`.agents/skills/deskohub-workspace-e2e/references/preview-workflow.md:88`). The admin role column (B), the plugin fields (A), and the grant table (C) all live in that copied database, so **every option carries production grants into new previews**:

- A production administrator can sign in to a preview with the inherited email (magic link or OTP) and reach preview `/admin`. Today #394's synthetic Basic credentials prevent this. Vercel deployment protection still stands in front of previews.
- Revoking a grant in production after a preview was forked does not reach that preview branch. The grant stays until the branch is deleted.
- None of these columns are PII, so the preview PII rule is not broken. The access change is still a behavior change the map should accept explicitly.
- E2E ([#621](https://github.com/totalolage/deskohub-site/issues/621)) has to grant a synthetic account on the branch through `E2EDatabase`. Any option supports this with one row or column write.

The only ways to keep production grants out of previews are a scrubber, which is forbidden, or ignoring stored grants outside production, which defeats a preview test of the real path. **Accept the inheritance**, or have [#624](https://github.com/totalolage/deskohub-site/issues/624) decide on a preview-specific rule.

## Comparison

| | A: admin plugin | B: `role` field | C: grant table |
| --- | --- | --- | --- |
| New HTTP surface | 15 endpoints; suppress via `disabledPaths` (HTTP only) | none | none |
| Self-promotion blocked | yes (`input: false`), but any admin can `set-role` | yes (`input: false`) | yes (not a Better Auth field) |
| Impersonation | on by default for `admin` | none | none |
| In `getSession` | yes | yes (or hide with `returned: false`) | no, extra query |
| Stale if cookie cache enabled | up to `maxAge` | up to `maxAge` | never |
| Provenance (who and when) | no | no | yes |
| Revocation, browser / CLI | next request / next request (needs CLI rewrite) | next request / next request | next request / next request |
| Preview inherits prod grants | yes | yes | yes |
| Migration | 5 columns + role backfill hook | 1 column | 1 table |
| Fit with repo conventions | poor | good | good |

## Recommendation

**Reject Option A.** The plugin solves user management that Workspace does not need. In return it mounts 15 endpoints, gives administrators impersonation and `set-role` by default, adds unused ban and impersonation columns, and can only be disabled path by path over HTTP.

**Choose Option B, `user.additionalFields.role` with `input: false`, if grants stay a rare, operator-run action.** That matches #390/#391: a handful of equal administrators, no admin-management UI, no audit ledger. It is the smallest change, it is literally "a stored role on the customer account", and the joined session query serves both the `/admin` guard and the admin menu entry with no extra lookup. Constrain the column to the single value `administrator` (or use a boolean), keep admin guards on the authoritative DB session, and pass `disableCookieCache: true` in the guard so a future cookie-cache change cannot delay revocation.

**Choose Option C instead if [#622](https://github.com/totalolage/deskohub-site/issues/622) decides administrators grant and revoke each other in the product and must see who granted access and when.** The grant row is then the natural place for that provenance, and the extra query per admin check is cheap.

With either B or C:

- Proxy-level Basic auth goes away. `proxy.ts` cannot check a role because it only sees the cookie, so the existing per-page and per-action guards become the gate.
- `approved_by` and the actor columns switch from usernames to user ids (#625).
- The CLI membership check queries the role or grant, which keeps #393's next-request invalidation.

## Facts that may change the plan

1. **Previews will admit production administrators.** Every DB-stored option is inherited by previews, unlike #394's synthetic credentials, and production revocations do not reach existing previews. #624/#621 should accept this explicitly.
2. **The first grant has to be written outside the product.** `auth.api.setRole` needs an admin session, and B and C have no grant path yet. The very first administrator needs a migration seed, a one-off SQL statement, or a CLI bootstrap. #622 should choose one.
3. **The proxy cannot gate `/admin` by role.** It only sees the cookie, and the cookie cache is off. Removing Basic auth moves the whole gate into the server guards that already exist. #624 should confirm what unauthenticated and non-admin visitors see.
4. **Actor history.** Existing `approved_by` and actor values are Basic usernames such as `admin`. Changing to user ids needs a mapping or a "legacy username" representation (#625).
