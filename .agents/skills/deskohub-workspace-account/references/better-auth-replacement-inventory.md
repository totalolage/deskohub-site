# Better Auth replacement inventory

Research date: 2026-09-02

## Decision

Rebuild the customer-account base on current `main` by retaining its account
domain and product behavior, replacing its managed-Neon runtime and delivery
integration, and adapting its database, CI, legal, and E2E seams to infrastructure
that has landed since the pull request was written. Do not mechanically rebase or
cherry-pick its commit sequence: the first feature commit contains almost the whole
implementation, while later commits are fixes against an obsolete provider shape.

This inventory does not reopen the selected provider. The companion
`customer-authentication-options.md` research selected Better Auth embedded in the
Workspace application, using the existing branch-specific Neon database rather
than a separate auth service or database. That recommendation remains the context
for this audit. Better Auth documents an in-process Next.js handler, its own Drizzle
adapter, magic links, and user deletion. See the official [Next.js integration](https://better-auth.com/docs/integrations/next),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[magic-link plugin](https://better-auth.com/docs/plugins/magic-link), and
[user management](https://better-auth.com/docs/concepts/users-accounts).

## Source baseline

- Account implementation: pull request [feat(workspace): add Neon Auth customer
  accounts](https://github.com/totalolage/deskohub-site/pull/239), head
  [`c99e12b5`](https://github.com/totalolage/deskohub-site/tree/c99e12b5168b5626638d4c3157c1617aecb998f3).
- Current base: [`main` at `33a840eb`](https://github.com/totalolage/deskohub-site/tree/33a840eb5ab15e4bbfa5572617962af30a650f4a).
- The pull request is 177 commits behind current `main`, 12 commits ahead, and
  conflicting. A merge simulation against those exact commits reports textual
  conflicts in `.github/workflows/workspace-tests.yml` and
  `apps/deskohub-workspace/e2e/preview-readiness.ts`.
- The pull request changes 71 files and adds 11,025 lines; 6,044 lines are its
  generated Drizzle snapshot. Its initial feature commit adds 10,126 lines, so
  commit-by-commit transplantation does not provide useful separation.

## Retain, adapt, delete matrix

| Area | Disposition | Existing assets | Required treatment |
| --- | --- | --- | --- |
| Account domain contracts | Retain | `features/account/contracts.ts`; `customer-account.ts` | Keep name validation, explicit deletion confirmation, safe account failure union, reservation statuses/groups, and branded opaque account ID. Change only the ID description that names Neon Auth. |
| Identity-to-customer boundary | Retain | `CustomerAccountResolver`; `CustomerAccountLinkRepository`; `customer_account_links` | Preserve the one-to-one opaque mapping, exact verified-email first claim, authoritative existing link, no Dotypos customer creation, uniqueness-backed race handling, and fixed non-PII failure codes. These types are the stable boundary consumed by descendants. |
| Account concurrency | Adapt | `withWorkspaceDatabaseAdvisoryLock`; `deleteCustomerIdentity`; database race tests | Preserve the per-account advisory lock and authoritative session recheck. Rebase the pool helper on current `main`'s connection/acquisition timeout handling and decide deletion hooks, transactions, and any auth-user foreign key under Better Auth. |
| Reservation history | Retain | `CustomerReservationHistoryService`; grouping tests; `ReservationHistory` | Keep Dotypos as source of live facts, use local reservation rows only to enrich product and fulfillment state, and retain current/past/cancelled/unavailable grouping. No auth provider types leak into this path. |
| Profile and account page | Retain | `AccountPage`; `ProfileCard`; `DeleteAccountCard`; account route; `page-data.server.ts` | Keep the bare profile, read-only verified email, reservation page, deletion dialog, dynamic rendering, server-side authorization, and private/no-store response handling. Adapt session calls and redirect plumbing only. |
| Site navigation and localization | Retain | Header account entry; English and Czech account messages; route metadata | Keep the product copy and accessible account navigation. Provider-widget localization keys become ordinary custom-form copy. |
| Authentication capability | Adapt | `CustomerAuthentication` service contract | Keep `currentUser`, `updateName`, and `deleteUser` as the narrow testable capability. Replace `getNeonAuth` calls with Better Auth server APIs, pass request headers explicitly, preserve authoritative database session checks, and keep provider failures behind fixed account error codes. Do not add another generic provider abstraction. |
| Auth route | Replace | `app/api/auth/[...path]/route.ts` and test | Replace Neon Auth's five-method proxy with Better Auth's documented Next.js handler at `/api/auth/[...all]`; retain a focused fail-closed/configuration test where the chosen runtime contract requires it. |
| Auth browser client and pages | Replace | `auth.client.ts`; `AuthProvider`; `AuthView`; auth route/layout | Remove Neon UI components and implement the minimal existing-product magic-link form and logout behavior with Better Auth's client. Preserve locale-aware safe redirects, success/error states, implicit signup, and existing styling primitives. |
| Auth styling dependency | Delete | `@neondatabase/auth/ui/tailwind` in `app/globals.css` | No provider stylesheet is needed for a custom form built from the application's existing UI primitives. |
| Provider dependency | Replace | `@neondatabase/auth` and lockfile graph | Replace with pinned Better Auth packages chosen by the runtime/database decision. Do not retain legacy Stack/Neon Auth packages. |
| Environment configuration | Replace | `NEON_AUTH_BASE_URL`; `NEON_AUTH_COOKIE_SECRET`; env schema/tests/examples; Turbo allowlists | Remove the managed-service base URL. Define Better Auth's secret, trusted-origin/base-URL, and email settings once in the typed environment boundary. Preserve paired/fail-closed validation only where the final configuration actually has paired values. |
| Auth persistence migration | Replace | Link-only migration and 6,044-line snapshot | Retain the `customer_account_links` table semantics, but regenerate one migration from current `main` containing the reviewed Better Auth tables and chosen relationship. The existing snapshot describes an old base and code that never shipped, so it is not migration lineage to preserve. |
| Drizzle runtime integration | Replace | Assumption that the existing Drizzle instance can back auth | Workspace uses `drizzle-orm/effect-postgres`, whose queries return Effects. Better Auth's Drizzle adapter expects Promise-returning Drizzle operations; upstream closed direct Effect-adapter support as not planned in [better-auth/better-auth#7234](https://github.com/better-auth/better-auth/issues/7234). Share the existing singleton `pg.Pool` but build the conventional node-postgres Drizzle facade required by Better Auth, or choose its direct PostgreSQL adapter after proving the schema/migration tradeoff. Do not create another pool or database. |
| Focused account tests | Retain | Resolver, deletion, history, schema, and link repository tests | Keep behavior assertions. Replace Neon mocks only in auth configuration/route tests. Run database tests through current `main`'s migrated disposable-Postgres helper instead of a feature-specific opt-in flag. |
| Workspace functional-test workflow | Adapt | PR-added PostgreSQL service, manual migration script, special account test step | Current `main` already provides PostgreSQL, validates generated migrations, migrates the normal test database, and exposes `shared/testing/workspace-postgres-test-database.test-utils.ts`. Delete the duplicate service/manual migration/special command and register account database tests in the normal Workspace test task. |
| Browser lifecycle | Adapt | `e2e/playwright-account/account.pw.ts`; Playwright project | Preserve the full user story and selectors: anonymous redirect, validation, signup, current history, profile, logout, returning login, past history, confirmation-gated deletion, revoked session/link, and fresh signup. Replace only magic-link acquisition, authoritative Better Auth session decoding, and synthetic auth-user cleanup. |
| Neon Auth E2E integration | Delete | `e2e/integrations/neon-auth.ts` and its five tests | Delete Neon management discovery, webhook mutation/restoration, JWKS/JWS verification, Cloudflare quick tunnels, provider user deletion, and proxy verification URL logic. None exists in direct Better Auth. |
| E2E configuration and workflow | Adapt | Neon API/project/branch inputs; Cloudflare installation; readiness endpoint; E2E config/env/Turbo tests | Remove Neon Auth management credentials and the tunnel installation. Add only the selected synthetic mailbox/retrieval capability. Preserve exact-SHA protected preview, matching Neon branch, database assertions, redaction, interruption-safe cleanup, and the account Playwright dependency on a real reservation fixture. |
| Email delivery | Replace | Neon-owned magic-link sending | Better Auth delegates delivery to `sendMagicLink`. Reuse the application's provider capability only through a secret-safe path: the current shared service annotates whole messages and recipients, and its development console provider prints bodies. A bearer-token URL must never enter logs, traces, or CI output. The final path also needs deterministic synthetic-only E2E retrieval without exposing the production email credential. |
| Preview readiness | Adapt | Added `/api/auth/get-session?disableCookieCache=true` probe | Keep an auth readiness probe, but update the route/query and expected unauthenticated response to the Better Auth contract. Reconcile it with current `main`, where this is one of the two textual merge conflicts. |
| Privacy policy | Adapt | English and Czech customer-account additions | Keep identity/profile/session/token categories, purpose, retention boundary, self-service deletion, and retained business-record distinction. Replace claims that Neon provides managed authentication with the actual app-owned Better Auth, Neon database, and email-provider responsibilities. |
| Account skill | Replace in part | `.agents/skills/deskohub-workspace-account/SKILL.md` | Preserve resolver, domain, deletion, dynamic-page, safe-error, and exact-preview E2E invariants. Replace managed-Neon setup, route, webhook, tunnel, and deployment instructions with the decisions reached for direct Better Auth. |
| General stacked-PR CI changes | Extract from auth | `.github/workflows/dhw-ci.yml`; removal of `branches: [main]`; `stacked-pr-ci-workflow.test.ts`; broad PR-review skill additions | These changes are provider-neutral but are not customer authentication. Current `main` does not contain the branch-filter changes. Keep them only if the separate stack-planning decision requires checks on non-`main` bases; otherwise omit them from the rebuilt auth PRs. |

## Stable compatibility boundary

The reusable public API is already narrow:

- `CustomerAccountResolver`
- `resolveCurrentCustomerAccount()`
- `CustomerAccountAccessError`
- `CustomerAccountId`
- `LinkedCustomerAccount`

Descendants should continue to consume that boundary rather than Better Auth
session or schema types. The authentication implementation may change completely
behind `CustomerAuthentication` without forcing reservation/order code to know the
provider. Preserve the database meaning of `customer_account_links`: auth user ID
to Dotypos customer ID, one-to-one.

## Superseded work on current `main`

Current `main` owns newer infrastructure that the replacement must use instead of
resolving the old diff in favor of the pull request:

1. [`workspace-tests.yml`](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/.github/workflows/workspace-tests.yml)
   now provisions the repository's required PostgreSQL image, validates generated
   migrations, and supplies `WORKSPACE_TEST_DATABASE_URL` to the normal test task.
2. [`workspace-postgres-test-database.test-utils.ts`](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/shared/testing/workspace-postgres-test-database.test-utils.ts)
   connects once, applies all migrations, exposes a `WorkspaceDatabase` layer, and
   fails closed when the configured disposable database is unavailable. It
   supersedes the PR's manually applied link migration and special test command.
3. [`database-provider.server.ts`](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/db/database-provider.server.ts)
   now applies shared pool timeouts. The account advisory-lock addition must be
   replayed on this version, not used to replace it.
4. The current [preview readiness](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/apps/deskohub-workspace/e2e/preview-readiness.ts)
   and [Workspace E2E workflow](https://github.com/totalolage/deskohub-site/blob/33a840eb5ab15e4bbfa5572617962af30a650f4a/.github/workflows/workspace-e2e.yml)
   have continued evolving. Add the Better Auth probe and mailbox capability to
   their current shape; do not restore the PR's Neon webhook/tunnel block.
5. Current `main` has no auth dependency. Generate the lockfile from current
   dependencies rather than trying to resolve the old Neon Auth lock graph.

## Commit treatment

| Commits in the base PR | Treatment |
| --- | --- |
| `feat(workspace): add Neon customer accounts` | Transplant provider-neutral files/behavior by area; do not cherry-pick the monolithic commit. |
| Deletion locking, authoritative-rendering, resolver exposure, schema/test hardening fixes | Preserve their resulting invariants while rebuilding on current `main`. |
| Neon provisioning/deployability and live Neon webhook E2E fixes | Replace with Better Auth runtime, email retrieval, and exact-preview validation. |
| Skill and PR-review guidance | Split provider-neutral durable guidance from managed-Neon and unrelated stacked-PR instructions. |

## Resulting planning constraints

The implementation plan can now treat the following as fixed:

- Preserve the provider-independent account domain, one-to-one link, page/UI,
  reservation history, locking invariants, and full browser lifecycle.
- Keep Better Auth behind the existing account capability; never expose its
  session or schema types to descendant order/reservation code.
- Share the existing `pg.Pool`, but do not pass the Effect Drizzle client to
  Better Auth.
- Replace the unshipped migration and all Neon Auth UI/runtime/webhook/tunnel
  machinery rather than maintaining compatibility with it.
- Rebase database tests, readiness, email, workflows, and lockfile work on their
  current-`main` owners.
- Resolve magic-link token-safe delivery/retrieval, Better Auth security/session
  configuration, persistence/deletion integrity, and final PR-stack ordering in
  their dedicated decision tickets.

No production data, credentials, or provider identifiers were inspected for this
inventory.
