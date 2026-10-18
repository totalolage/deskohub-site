# Workspace protected-preview E2E

## Contents

- [How a run reaches a preview](#how-a-run-reaches-a-preview)
- [Run E2E](#run-e2e)
- [Environment contracts](#environment-contracts)
- [Preview database](#preview-database)
- [Protection and callbacks](#protection-and-callbacks)
- [CI workflow rules](#ci-workflow-rules)
- [Verify a change](#verify-a-change)

## How a run reaches a preview

`.github/workflows/workspace-e2e.yml` runs on the Vercel `repository_dispatch` events for the Workspace project's Preview environment:

1. Vercel builds the protected Git preview, and the Neon integration creates its database branch.
2. On `vercel.deployment.success`, the `resolve-target` job checks the project, environment, SHA, PR, and URL. It accepts only an open, internal, non-draft, non-Dependabot PR whose head is the target SHA.
3. The `test-e2e` job leases a date shard, installs dependencies, resolves and migrates the preview's Neon branch, validates Dotypos capacity, and runs `bun turbo test:e2e --filter=deskohub-workspace`.
4. `publish-final-status` publishes the commit status.

On `vercel.deployment.skipped`, `publish-skipped-status` checks the exact-SHA skipped deployment and carries the nearest earlier Workspace E2E status forward. No earlier status or an earlier success becomes success; anything else stays failure. Never infer a skip from changed paths or reuse an older preview.

The target is always the immutable `.vercel.app` deployment origin for the exact SHA, taken from the dispatch payload. Never scrape the Vercel PR comment or use a branch alias or custom domain.

## Run E2E

- **Manual dispatch.** Run the workflow with `sha` (40 characters), `url` (immutable HTTPS deployment URL), and `ref` (internal PR head branch). The same PR guards apply, and the job fails before it allocates or mutates shared state unless GitHub deployment metadata records that URL as a successful Workspace deployment for that SHA. Set `cleanup_stale_e2e_reservations` only for an intentional stale-reservation cleanup (see [suite orchestration](suite-orchestration.md#dotypos-capacity-and-stale-reservations)).
- If Vercel finishes a preview before an open internal PR exists for its SHA, the `repository_dispatch` E2E run skips with `No eligible open internal PR matches the exact deployment SHA`. Once the PR exists, restart it with the manual dispatch from `main`, using the exact SHA, immutable preview URL, and branch:

  ```bash
  gh workflow run workspace-e2e.yml --ref main -f sha=<head> -f url=<immutable preview URL> -f ref=<branch>
  ```
- **Local run against a preview.** From the repository root, run `bun turbo test:e2e --filter=deskohub-workspace` with the variables in [runner variables](#runner-variables). The task depends on `i18n:compile` and `@deskohub/igloohome#generate`.
- **Instant navigation only.** `bun run test:instant-navigation` from `apps/deskohub-workspace`. Without `WORKSPACE_E2E_BASE_URL`, the Playwright configs start `turbo dev` and target `http://localhost:3000`, and the administration navigation skips because its seeded administrator needs a preview and its E2E database.

Bun loads dotenv files before the entry module runs. Email-provider secrets that exist only in Vercel are intentionally unavailable to local E2E.

## Environment contracts

Inspect settings and deployment metadata without printing values.

### Vercel Preview environment (Workspace project)

- Neon integration-managed `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
- Nexi sandbox `NEXI_API_ORIGIN` and `NEXI_API_KEY`, plus `NEXI_CHECKOUT_CURRENCY_OVERRIDE=EUR` for the current sandbox merchant.
- E2E Dotypos URL, credentials, and tenant IDs. The E2E cloud needs at least one active percentage discount group between 0.01% and 90%; the runner picks one deterministically and fails closed when none exists.
- `EMAIL_API_KEY`. Env validation requires it in Preview and production. Recipient routing sends mail for `EMAIL_TEST_DOMAIN` recipients to Console, so E2E sends no real mail; a real person using a preview gets real mail.
- `EMAIL_CAMPAIGN_ADMIN_INBOX` set to an `@deskohub.test` address, so campaign test sends and their confirmation codes stay on Console and in the server logs. `EMAIL_CAMPAIGN_FROM` and `EMAIL_CAMPAIGN_REPLY_TO` are optional in Preview.
- `POSTHOG_FEATURE_FLAG_OVERRIDES={"calendar_sales":true,"customer_discounts":true,"discount_codes":true,"meeting_room_page":true,"office_page":true,"referrals":true}`. The referral lane needs `referrals:true`, even when the production rollout is off. The account lane skips the passkey cases unless `login_passkeys` is on, and the sign-in code case unless `login_email_code` is on; turn them on for a PR with a branch-scoped override. A branch-scoped override replaces the whole map, so include every flag. Set it before the preview is built; Vercel accepts a branch scope only after the branch is pushed.
- `GOOGLE_CALENDAR_SALES_ID` for the dedicated E2E sales calendar (see [fixtures](fixtures.md#calendar-sale-event)).
- `VERCEL_AUTOMATION_BYPASS_SECRET` for Deployment Protection.

Never put production Nexi, Dotypos, or database credentials in Preview. Never add callback-origin or BotID test overrides.

### GitHub `workspace-checkout-e2e` environment

| Name | Kind | Purpose |
| --- | --- | --- |
| `WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN`, `WORKSPACE_E2E_POSTHOG_HOST` | Variables | Public ingest token and host for E2E traces. Management and trace-read keys stay secrets elsewhere. |
| `WORKSPACE_E2E_VERCEL_TOKEN` | Secret | Opaque token for the request-log history route; never enters Vercel or app config. |
| `WORKSPACE_E2E_VERCEL_PROJECT` | Variable | Project for log retrieval. |
| `WORKSPACE_E2E_COORDINATOR_DATABASE_URL` | Secret | Allocator role; used only by the trusted allocation action. |
| `WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL` | Secret | Connect-only role for the replay permit. |
| `WORKSPACE_E2E_BETTER_AUTH_SECRETS` | Secret | Copy of the Preview-only `BETTER_AUTH_SECRETS` that signs seeded referral and administrator sessions ([seeded sessions](referral-lane.md#seeded-sessions)). |
| `WORKSPACE_E2E_DOTYPOS_*` | Secrets | E2E Dotypos cloud; mapped to `DOTYPOS_*` per step. |
| `VERCEL_AUTOMATION_BYPASS_SECRET`, `NEON_API_KEY`, `TURBO_TOKEN` | Secrets | Protection bypass, branch lookup, remote cache. |

### Runner variables

`e2e/e2e-env.ts` selects, validates, and decodes these once and passes typed config to telemetry, Layers, and child processes. The `test:e2e` entry in the root `turbo.json` lists them in `passThroughEnv`.

- `WORKSPACE_E2E_BASE_URL`: the one target origin. The runner validates it as an immutable HTTPS Vercel deployment and uses it for browser cases, availability, Nexi result and status host checks, readiness, webhook replays to `/api/webhooks/nexi`, and status pages.
- `DATABASE_URL` (pooled), `WORKSPACE_E2E_DATABASE_URL_UNPOOLED`, `WORKSPACE_E2E_DATABASE_ALLOWLIST` (direct): must identify the database behind that same preview.
- `NEXI_API_ORIGIN`: the sandbox origin, supplied explicitly.
- `WORKSPACE_E2E_ALLOCATION_SHARD`, `WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED`, `WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL`: see [suite orchestration](suite-orchestration.md).
- `WORKSPACE_E2E_EXECUTION_CONTEXT`: `manual` or `ci`. Locally it defaults to `manual`; the workflow sets `manual` for `workflow_dispatch` and `ci` for the repository dispatch. A rerun keeps its trigger's value.
- `WORKSPACE_E2E_REVIEW_SCREENSHOTS=true`: opt-in PR review screenshots (see [browser driving](browser-driving.md#review-screenshots)). The workflow doesn't set it.

## Preview database

The Neon/Vercel integration owns the preview branch `preview/<internal-head-ref>`, including its creation and deletion. In `test-e2e`, after dependency install, the workflow:

1. Finds exactly one non-primary branch with that name using pinned `neonctl@2.30.1`, installed once.
2. Gets its direct and pooled connection strings and masks each at once.
3. Migrates with the direct URL (`bun run db:migrate`) before stale cleanup, capacity validation, and browser setup.

Runtime traffic uses the pooled URL; migrations, assertions, and the allowlist use the direct URL. The workflow fails closed when the branch is missing, ambiguous, primary, or mismatched. It never falls back to production or shared development. Don't create, expire, or delete integration-owned branches from the repository.

The preview is Ready before CI migrates it. Keep the Workspace build database-independent, and make schema changes compatible with that order. Don't add migrations to the Vercel build.

Production-derived preview branches may hold only the inherited Better Auth login email, pending-verification email, short-lived rate-limit IP keys, passkey rows (including customer-written labels), administrator role grants, and the administrator login-email snapshots in administrator provenance records. Everything else, including every fixture and all Dotypos profile and reservation data, is synthetic. Don't add a branch scrubber or an alternate parent branch.

Put database integration assertions inside the normal E2E runner and use its scoped `E2EDatabase` service. Don't add a dedicated script, Turbo task, file-naming convention, environment switch, or per-case database allowlist for them. Repository-level proofs that need no deployed app, such as invoice issuance, numbering, and immutability, belong in the owning repository's colocated `*.postgres.test.ts` instead: they need an exclusive database, and the shared preview branch can give them one only by serializing them after every paid case. E2E code may reuse application repositories only through their injectable service contracts; importing a contract must not initialize the app database pool, load the app keyring, or validate unrelated app variables.

## Protection and callbacks

- Browser navigation sets the bypass cookie, readiness checks send the bypass header, and direct Nexi webhook replays send `x-vercel-protection-bypass`. Workspace appends the bypass query parameter to preview Nexi result and notification URLs.
- Prime the bypass cookie with a stable public asset the app ships, and require success. A missing asset returns 404 even with a valid bypass.
- Non-production callback origins come from `VERCEL_URL`; production uses `VERCEL_PROJECT_PRODUCTION_URL`.
- Preview visitor GET and HEAD navigation redirects to the immutable callback origin before sign-in and reservation preparation, so host-only session and checkout cookies live on the host Nexi returns to. The immutable-host suite doesn't cover this; when you change the boundary, check direct alias page loads and client navigation by hand.
- BotID runs only in Vercel production. Read the `deskohub-workspace-botid` skill before changing that boundary.
- Webhook replay only triggers the handler. The handler must still read authoritative order state from Nexi.

## CI workflow rules

- The repository-dispatch workflow definition comes from the default branch even when the job checks out the PR SHA. Don't make exact-SHA validation depend on a workflow-level value changed in the same PR; keep expectations in the checked-out runner or in an already-compatible dispatch contract.
- When you add a runner-owned workflow variable, add it to `passThroughEnv` for `test:e2e` in the root `turbo.json` and test the workflow-to-task boundary. Turborepo's strict env mode drops it silently otherwise.
- The Bun package cache uses an exact `bun.lock` key with no restore keys. On a miss, the fill step copies `bun.lock`, tracked `package.json` files, and tracked `*.patch` files into `$RUNNER_TEMP` and runs `bun install --frozen-lockfile --ignore-scripts` there; the cache is saved before any exact-SHA code, `bunfig.toml`, `.npmrc`, or lifecycle script takes effect. Keep every step before the save free of exact-SHA code and configuration, and extend `scripts/workspace-e2e-bun-cache-fill.test.ts` when you change the fill. Keep `no-cache: true` on `setup-bun`.
- The Playwright reporter writes each job's whole summary in the Playwright step. Don't assemble Markdown across steps; each step has its own `GITHUB_STEP_SUMMARY` file.
- Failure artifacts (`e2e-artifacts/**`) are kept for seven days.

## Verify a change

Run from the repository root:

```bash
bun turbo i18n:compile --filter=deskohub-workspace
bun turbo test --filter=deskohub-workspace
bun turbo typecheck --filter=deskohub-workspace
bun turbo lint --filter=deskohub-workspace
git diff --check
```

`bun turbo test` generates the API clients and Paraglide output first. After that, run single files from `apps/deskohub-workspace` with `bun run test <path>`, which supplies the preload and `--parallel=1`.

For a deployed run, record only non-secret evidence:

1. The tested SHA equals the deployment SHA, and the target is the immutable deployment URL.
2. No deployment, alias, or domain change happened inside E2E.
3. The migrated Neon branch backs that preview and is neither production nor shared development.
4. Navigation passed Deployment Protection, Nexi returned to the same preview host, and replays reached that preview's `/api/webhooks/nexi`.
5. A deliberate case failure stops new admissions while running tests close their own browser contexts and clean up exactly.
