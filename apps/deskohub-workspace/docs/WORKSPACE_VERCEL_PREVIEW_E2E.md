# Workspace protected-preview E2E

Workspace E2E tests run only against the ordinary immutable Vercel Git preview
for the exact commit under test. Every Workspace preview remains protected by
Vercel Deployment Protection. Automation, Nexi returns, and webhook replays use
the protection-bypass mechanism; application BotID is a Vercel-production-only
control and is not initialized or enforced in Preview or Development.

The complete CI flow is:

```text
PR commit
  -> Vercel builds the protected Git preview and the Neon integration branch
  -> Vercel emits vercel.deployment.success
  -> Workspace E2E validates the project, Preview environment, SHA, PR, and URL
  -> CI resolves and migrates the preview's Neon branch
  -> every browser, callback, status, and replay request uses that preview URL
```

## What can be tested

Full E2E validates committed and pushed code through the immutable preview
created for that commit. Uncommitted local code has no externally reachable Git
preview and must not be presented as if it were tested through an older
deployment. Local unit and functional tests remain useful before pushing.

The normal repository-dispatch trigger works only after the workflow exists on
the default branch. Before then, dispatch `.github/workflows/workspace-e2e.yml`
manually with the exact 40-character SHA, immutable HTTPS deployment URL, and
internal PR head ref. The workflow applies the same open, internal, non-draft,
non-Dependabot PR guards to manual runs.

Never scrape a Vercel PR comment or use a branch URL. The E2E target must be the
immutable `.vercel.app` deployment origin emitted for the exact SHA.

## Preview environment contract

The Workspace Vercel project's Preview environment must provide these variable
names. Inspect settings and deployment metadata without printing their values.

- Neon integration-managed `DATABASE_URL` and `DATABASE_URL_UNPOOLED`.
- Nexi sandbox `NEXI_API_ORIGIN` and `NEXI_API_KEY`.
- `NEXI_CHECKOUT_CURRENCY_OVERRIDE=EUR` for the current sandbox merchant.
- Workspace E2E Dotypos URL, timeout, credentials, and tenant IDs.
- `EMAIL_PROVIDER=console`; the runner marks console fulfillment delivered only
  after the deployed payment/webhook path has completed.
- `VERCEL_AUTOMATION_BYPASS_SECRET` for Deployment Protection.

Do not use production Nexi, Dotypos, email, or database credentials in Preview.
Do not add callback-origin or BotID test-bypass overrides. Non-production
callback origins derive from the deployment's `VERCEL_URL`; production derives
from `VERCEL_PROJECT_PRODUCTION_URL`.

Workspace appends the protection-bypass query parameter to preview Nexi result
and notification URLs when configured. Browser navigation establishes the
bypass cookie, readiness checks use the bypass header, and direct Nexi webhook
replays send the `x-vercel-protection-bypass` header.

## Preview database identity and migration

The Neon/Vercel integration owns the preview database branch for the Git branch
and deployment lifecycle. Its validated mapping is
`preview/<internal-head-ref>`. E2E waits for
the successful Vercel preview event, resolves that exact non-primary Neon
branch, obtains its direct and pooled connection strings with pinned
`neonctl@2.30.1`, masks each immediately, and migrates with the direct URL.
Runtime traffic uses the pooled URL; database assertions and the allowlist use
the direct URL for the same branch.

The workflow fails closed if the branch is missing, ambiguous, primary, or does
not match the validated PR ref. It never falls back to production or a shared
development database. Individual E2E runs do not create, expire, or delete the
branch. The Neon/Vercel integration that creates the branch also owns its
cleanup. Keep automatic deletion of obsolete preview branches enabled in the
integration, and do not add repository workflows that delete integration-owned
branches.

The preview becomes Ready before CI runs migrations. That ordering is safe only
while the Workspace build is database-independent and runtime traffic does not
require a schema-breaking migration before E2E starts. Schema-breaking changes
must preserve compatibility with this ordering or introduce a preview-only
pre-runtime migration mechanism. Do not add migrations to the Vercel build.

Production remains unchanged: build a staged production deployment, migrate the
production Neon branch, then promote the ready deployment.

## Runner target and safety

`WORKSPACE_E2E_BASE_URL` is the single required target origin. The runner
validates it as an immutable HTTPS Vercel deployment, derives the expected host,
and uses it for:

- all browser cases and availability requests;
- Nexi result and status host assertions;
- Nexi and Resend endpoint readiness;
- replay POSTs to `/api/webhooks/nexi`;
- status-page checks after fulfillment transitions.

`DATABASE_URL`, `WORKSPACE_E2E_DATABASE_URL_UNPOOLED`, and
`WORKSPACE_E2E_DATABASE_ALLOWLIST` must identify the database backing that same
preview. `NEXI_API_ORIGIN` must be supplied explicitly as the sandbox origin.
The runner does not deploy, pull Vercel environment files, inspect deployments,
or mutate aliases/domains.

Webhook replay is only a deterministic notification trigger. The deployed
handler must still fetch authoritative order state from Nexi before applying a
payment transition. Keep raw payloads, credentials, customer data, and
connection strings out of logs and artifacts.

## Verification

Run from the repository root:

```bash
bun turbo i18n:compile --filter=deskohub-workspace
bun test apps/deskohub-workspace/e2e
bun --cwd apps/deskohub-workspace test shared/backend/bot-protection
bun --cwd apps/deskohub-workspace typecheck
bun --cwd apps/deskohub-workspace lint
git diff --check
```

For a real run, record only non-secret evidence:

1. The tested Git SHA equals the Vercel deployment SHA.
2. The target is the immutable deployment URL, not a branch alias or custom domain.
3. No Vercel deployment command runs inside E2E.
4. No Vercel alias or domain mutation occurs.
5. The migrated Neon branch is the branch backing that preview and is neither production nor shared development.
6. Browser navigation succeeds through Vercel Deployment Protection.
7. Nexi returns to the same preview host.
8. Replay reaches that preview's `/api/webhooks/nexi`, whose handler verifies authoritative Nexi state.
9. An intentionally induced case failure interrupts siblings and closes their browser sessions.
10. Deleting the test PR's Git branch lets the Neon/Vercel integration remove
    its obsolete preview branch without a repository cleanup workflow.

Failure artifacts remain available for seven days. The suite must retain
fail-fast parallel aggregation, scoped browser sessions, cancellation
propagation, bounded finalizers, case watchdogs, and discrete semantic-step
timeouts.

For Nexi sandbox facts and cards, see
[`../../../packages/nexi/docs/TESTING_API.md`](../../../packages/nexi/docs/TESTING_API.md).
