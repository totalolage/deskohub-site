# How E2E and previews sign in as an administrator

Research for [#621](https://github.com/totalolage/deskohub-site/issues/621) (map [#618](https://github.com/totalolage/deskohub-site/issues/618)). Source revision: `origin/main` at `b98360e68`, read 2026-10-16. Paths are relative to `apps/deskohub-workspace/` unless they start with `.github/`, `.agents/`, or `AGENTS.md`.

## Recommendation

1. **E2E:** add an administrator grant to the seeded-session fixture the referral lane already uses. In one transaction, the runner inserts a synthetic `@deskohub.test` Better Auth user and its administrator grant into the exact preview branch. It then inserts a short-lived `auth.session` row and sets the signed `__Secure-better-auth.session_token` cookie in the case's browser context. The app authorizes that cookie through its normal session lookup and role check. The account goes into the cleanup journal, and deleting the user cascades the grant away. No app endpoint, query parameter, or seed script is involved.
2. **Real sign-in coverage:** add one account-lane case that grants a synthetic account administrator, signs in through the real magic link retrieved from the gated Preview log line, and reaches `/admin`. Add one negative case: a signed-in non-administrator is refused at `/admin`.
3. **Developers on a preview:** sign in with their own production account through the normal magic link. Preview mail to real addresses goes through Resend. The preview branch inherited both the account and its grant at the branch point. This needs a decision, covered under [Decision needed](#decision-needed-inherited-grants-on-preview-branches).
4. **Storage:** E2E works the same way with all three options. For storage reasons, a separate grant table is the better fit: it follows the existing `public.customer_account_links` pattern, and it avoids the admin plugin's user-management endpoints. See [Options](#storage-options).

## How E2E signs customers in today

There are two paths, and both run against the real preview.

- **Real magic link (account lane).** Cases sign in through Better Auth's handler and get the link, or the six-digit code in `account-sign-in-code`, from the gated `account.magic-link.preview-e2e` Vercel log line (`retrieveMagicLink` / `retrieveSignInEmail`). That line is emitted only on Vercel Preview, only for recipients that exactly match `delivered+<run-id>-<label>@<EMAIL_TEST_DOMAIN>`, and only after Console accepted the send (`.agents/skills/deskohub-workspace-account/references/magic-link-delivery-and-e2e.md`, "The two authorized bearer-link log lines"). There is no inbox capture. Cases: `account-magic-link-delivery`, `account-session-lifecycle`, `account-deletion-and-reactivation`, and others (`e2e/account/cases.ts`).
- **Seeded session (referral lane).** `e2e/account/seeded-session.ts` signs a browser in "without a magic link":
  - `seedWorkspaceE2ESyntheticAccount` (`:84-109`) inserts a verified `auth.user` row, plus a `customer_account_links` row when the profile counts as completed.
  - `signInWorkspaceE2ESyntheticAccount` (`:118-165`) inserts an `auth.session` row with a 60-minute lifetime (`:27`). It signs the token with Better Auth's own `makeSignature` (`:63-66`) and sets the cookie through `setBrowserCookie`.
  - The signing secret is `WORKSPACE_E2E_BETTER_AUTH_SECRETS`, a runner-only copy of the Preview-only `BETTER_AUTH_SECRETS`, registered for redaction and failing closed (`:40-57`).
  - Used by six referral cases (`e2e/referrals/cases.ts:1234-1239`).
- **Synthetic identities.** `testEmailAddress(localPart)` builds `localPart@deskohub.test` (`packages/test-email`). The account fixture uses `delivered+<runId>-<label>` (`e2e/account/config.ts:80-86`).
- **Cleanup.** Identities are journaled before the write. `removeSyntheticAuthUser` (`e2e/account/auth-rows.ts:105-117`) deletes exactly one user, and cascades remove sessions, accounts, and the link row. `e2e/account/reconcile.ts` reconciles journals during suite cleanup.
- **Functional tests** sign in through local Better Auth handler helpers (`makeTestAuth`, `signInForMagicLink`, `verifyMagicLink` in `features/account/backend/auth/auth-handler.test-utils.ts`). They don't use Better Auth's `testUtils` plugin, which 1.7.2 ships (`dist/plugins/test-utils`).

## How admin E2E works today

- `WORKSPACE_E2E_ADMIN_BASIC_AUTH` (`username:password`) is decoded in `e2e/e2e-env.ts:93,149` and validated in `e2e/admin-basic-auth.ts`. It pairs with the Preview-only Vercel registry `ADMIN_BASIC_AUTH_CREDENTIALS`, parsed in `shared/administrator/administrator-credentials.ts:49-93` (lines are `username:<sha256(username:password)>`).
- `openAdminBrowserPage` (`e2e/admin-case.ts:43-80`) opens a context with origin-scoped `httpCredentials` and `send: "always"`.
- The app checks the header twice: in `proxy.ts:121-141` and in `requireAdministratorAuthorization` (`administrator-authorization.server.ts:18-47`).
- Admin cases:
  - `access-code-creation`: `e2e/access-codes/create-access-code.pw.ts:63,70`.
  - `email-campaign-recipient-preview`: `e2e/email-campaigns/preview-campaign-recipients.pw.ts:64,71`.
  - Instant-navigation `admin-navigation`: `e2e/instant-navigation/admin-navigation.pw.ts:13-28`. It uses `test.use({ httpCredentials })`, and local runs fall back to the synthetic functional pair.
  - No E2E case calls the `/api/v1/cli` administration API.
- CI injects the secret in the single "Run checkout E2E" step (`.github/workflows/workspace-e2e.yml:488`). Both Playwright invocations get the same env, including the direct preview DB URL (`:490-492`) and the session secret (`:489`).
- Functional tests synthesize `admin` and `operator` registry entries and set `ADMIN_BASIC_AUTH_CREDENTIALS ??=` (`shared/testing/workspace-test-environment.ts:13-47`).

## How preview and E2E databases are created

- The Neon/Vercel integration creates and deletes `preview/<internal-head-ref>` per PR. The workflow only looks the branch up: pinned `neonctl`, exactly one non-primary branch, failing closed. It masks both URLs and runs `bun run db:migrate` with the direct URL after the preview is Ready (`.agents/skills/deskohub-workspace-e2e/references/preview-workflow.md`, "Preview database"; `.github/workflows/workspace-e2e.yml:437-471`).
- E2E uses that same PR branch. There is no per-run app branch. The runner reaches it through `WORKSPACE_E2E_DATABASE_URL_UNPOOLED`, guarded by `WORKSPACE_E2E_DATABASE_ALLOWLIST`. A separate long-lived `workspace-e2e-coordination` Neon project holds only run coordination and permits (`suite-orchestration.md:78-105`).
- **Preview branches are production-derived, with no scrubber.** Branches "copy production data at the branch point, and later production deletions don't reach existing branches". Adding a scrub job, a PII-free parent, a reset job, or a masking branch is forbidden (`.agents/skills/deskohub-workspace-account/references/privacy-and-retention.md`, Rules; `AGENTS.md`). The whole `auth` schema is therefore inherited: `user`, `session`, `verification`, and rate-limit rows. `public.customer_account_links` is inherited too.
- No app seed or administrator-bootstrap script exists. `package.json` scripts include `db:migrate` and `administrator-credentials:generate`. A seed script would also be pointless, because every preview starts as a copy of production.

## Storage options

Each option gets the same E2E mechanism: a direct insert in the seeded-session transaction through the scoped `E2EDatabase` service. No option needs a test-only endpoint, and the E2E skill forbids app bypasses ("never add query parameters, runtime branches, or other bypasses to the app for E2E", `.agents/skills/deskohub-workspace-e2e/SKILL.md`). The options differ in what else they bring.

### A. Better Auth admin plugin `role` field

- **Schema.** In 1.7.2 the plugin adds `user.role`, `banned`, `banReason`, and `banExpires`, plus `session.impersonatedBy` (`better-auth/dist/plugins/admin/schema.mjs:2-30`). Its options are `defaultRole: "user"`, `adminRoles: ["admin"]`, access control, and `adminUserIds` (`types.d.mts:16-68`, `admin.mjs:11-20`). These columns go into `db/schema/auth.ts` through `db:generate`, and Drizzle remains the migration authority.
- **E2E.** Set `role: "admin"` in the existing `authUser` insert. This is the smallest diff.
- **Developer on a preview.** An inherited production `role` works after a normal sign-in.
- **Costs.**
  - It mounts set-role, create/list/get user, ban/unban, impersonate, revoke sessions, remove user, and set password endpoints (`admin.mjs:66-85`). None has a per-endpoint switch; each must be listed in the global `disabledPaths` (`api/index.mjs:164-166`).
  - Left enabled, `listUsers` would let any preview administrator list inherited real login emails. `privacy-and-retention.md` forbids displaying those during E2E, and it is the wrong shape for previews in general.
  - `adminUserIds` grants admin by ID with no stored role (`has-permission.mjs:3-9`). It is environment config, not stored data, so it doesn't meet the storage requirement.

### B. Workspace-owned column on `auth.user`

- **Schema.** A server-owned additional field (`input: false`), like `deletionRequestedAt` (`features/account/backend/auth/auth-options.ts`).
- **E2E.** Set the column in the existing `authUser` insert.
- **Developer on a preview.** An inherited column value works.
- **Costs.** It puts an authorization fact into the identity row Better Auth owns. The value travels on every session `user` object, and every Better Auth upgrade has to coexist with it. There is no natural place for `grantedBy` / `grantedAt` actor fields.

### C. Separate grant table keyed by user ID

- **Schema.** For example `public.administrator_grants(customer_account_id → auth.user.id ON DELETE CASCADE, granted_at, granted_by)`. This mirrors `public.customer_account_links`, which stores only opaque IDs and cascades with the auth user (`privacy-and-retention.md`, "What each system holds").
- **E2E.** Insert one row in the same transaction as the user. The existing `removeSyntheticAuthUser` cascade and the journal reconciliation already cover it, but add an assertion to `e2e/cleanup.postgres.test.ts`.
- **Developer on a preview.** An inherited grant row works.
- **Costs.** One indexed lookup per admin request, and a new table in the privacy table and copy review.
- **Benefits.** Better Auth types stay out of the domain. The account boundary already enforces that (`lint/no-better-auth-in-account-domain.grit`). Revocation is a row delete, actor fields have a home, and no user-management endpoints are mounted.

## Decision needed: inherited grants on preview branches

Every storage option keeps the production grant in Neon, so every preview branch inherits it, and the no-scrubber rule rules out stripping it. The root `AGENTS.md` exception lists only "Better Auth login email, pending-verification email, and short-lived rate-limit IP keys". An inherited administrator grant is a fact about a real person, and it isn't on that list. Two consequences:

- A production administrator is automatically an administrator on every preview branched after the grant.
- A production revocation doesn't reach previews that already exist until the integration deletes them. Deployment Protection still applies, and signing in still needs the real mailbox.

**Recommended:** extend the `AGENTS.md` exception, and the matching lines in `preview-workflow.md` and `privacy-and-retention.md`, to cover administrator grants on inherited accounts. Doing so has no cost, needs no tooling, and replaces today's shared non-secret preview Basic auth pair.

**Alternative, if the exception is refused:** stop storing production grants in the branch-copied database. In practice that means config scoped to each environment, such as an `adminUserIds`-style allowlist. Preview grants would then have to be synthetic. A developer would sign in on a preview as a `delivered+<run>-<label>@deskohub.test` address via the gated Preview log, and grant it through a direct DB write with `neonctl` access. That workflow is heavier and contradicts the map's "stored role" destination.

If a preview predates a developer's production grant, an inherited administrator can grant them on that preview through whatever grant workflow the delivery plan builds. Production bootstrap of the first administrator also needs that workflow, so previews add no new requirement.

## Required changes

- **E2E fixture.**
  - Add an administrator option to `e2e/account/seeded-session.ts` (insert the grant in the same transaction as the user). Alternatively, add a sibling helper that composes `seedWorkspaceE2ESyntheticAccount` and `signInWorkspaceE2ESyntheticAccount`.
  - Journal the administrator identity like referral identities.
  - The resolver's error text now says "referral lane"; generalize it, because `WORKSPACE_E2E_BETTER_AUTH_SECRETS` becomes required for admin cases too.
- **`e2e/admin-case.ts`.** `openAdminBrowserPage` drops `httpCredentials` and takes the seeded administrator session, setting the cookie in the new context.
- **Admin cases.** `create-access-code.pw.ts` and `preview-campaign-recipients.pw.ts` seed an administrator, journal it, and sign it in instead of resolving a credential. Both already use `E2EDatabase`.
- **`e2e/instant-navigation/admin-navigation.pw.ts`.** This file has no run context, journal, or DB fixture today (`playwright.instant-navigation.config.ts` says it "needs no lease or run context"). Pick one:
  - Give the config a setup/teardown project that seeds one administrator, saves the cookie as `storageState`, and deletes the user afterwards.
  - Move the admin navigation test into the checkout graph.

  Local runs lose the synthetic Basic auth fallback either way and need the local database seeded instead.
- **Delete.** `e2e/admin-basic-auth.ts` and its test, `resolveInstantNavigationAdminCredentials`, `WORKSPACE_E2E_ADMIN_BASIC_AUTH` in `e2e/e2e-env.ts:93,149`, and `e2e/admin-case.test.ts:15`'s credential fixture.
- **New E2E cases.** One real magic-link administrator sign-in in the account lane, and one non-administrator refusal at `/admin`.
- **Workflow.** Remove `WORKSPACE_E2E_ADMIN_BASIC_AUTH` from `.github/workflows/workspace-e2e.yml:488`. After cutover, as an operations step, delete the GitHub secret and the Preview and Production `ADMIN_BASIC_AUTH_CREDENTIALS`.
- **Functional tests.**
  - Remove the synthesized registry, `workspaceTestAdminCredentials`, and `ADMIN_BASIC_AUTH_CREDENTIALS ??=` from `shared/testing/workspace-test-environment.ts`.
  - Grant administrator in tests by writing the chosen storage, then sign in through the existing `auth-handler.test-utils.ts` helpers.
  - Update `shared/testing/lint-rules.test.ts:451,454`.
- **Skills.**
  - `deskohub-workspace-e2e`: replace `references/fixtures.md` "Admin Basic auth" with an "Administrator session" section. Update `references/preview-workflow.md` (variables list), the admin-case pattern in `references/suite-orchestration.md:36`, and `references/referral-lane.md`'s seeded-session description, since it is now shared.
  - `deskohub-workspace-account`: document the role check beside the session re-check rule, plus the privacy-table row for option C.
  - Add the `AGENTS.md` exception amendment if it is approved.
- **Session freshness.** If the delivery plan gates admin mutations on Better Auth's 10-minute `freshAge`, seeded sessions are fresh only for 10 minutes after insert. Seed the session immediately before the mutation, or keep admin gates on the ordinary session.
