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
- Workspace E2E Dotypos URL, credentials, and tenant IDs.
- GitHub Actions variables `WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN` and, when
  using a non-default ingest region, `WORKSPACE_E2E_POSTHOG_HOST` in the
  `workspace-checkout-e2e` environment. The token is the public project ingest
  token, never a management API key or secret.
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

The runner relies on Bun to load dotenv files before the entry module executes.
`e2e/e2e-env.ts` is the only E2E boundary that reads `process.env`: it selects,
validates, and decodes the exact runner configuration once, before telemetry or
Effect Layers are constructed. Other E2E modules receive that immutable typed
configuration and must not read ambient environment variables. Application-only
variables are not projected into the E2E configuration, and E2E telemetry uses
only the dedicated `WORKSPACE_E2E_POSTHOG_*` variables.

All case, step, provider, browser, datasource, artifact, and cleanup timeouts
are static checked-in values in `e2e/timeouts.ts`. The runner does not accept
environment-variable timeout overrides.

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

## Suite telemetry

The Bun E2E process exports an OTLP trace to PostHog under its own
`deskohub-workspace-e2e` service name. One root `e2e.run` span contains an
`e2e.case` child for every case, and every semantic step is an `e2e.step` child
of its case. Span names are fixed and low-cardinality; code-owned case and step
IDs are attributes.

PostHog's native span duration is the authoritative elapsed time. Case and step
spans also record their configured `e2e.timeout_ms`, which allows actual
duration to be compared with the watchdog that governed the operation. Terminal
attributes use only the closed outcomes `passed`, `failed`, `timed_out`, and
`cancelled`, plus the closed failure kinds `error`, `defect`, and `timeout`.
The exact target SHA and GitHub run correlation values are included when
available.

The typed `WORKSPACE_E2E_EXECUTION_CONTEXT` value distinguishes `manual` from
`ci`. Local execution defaults to `manual`. GitHub Actions sets it explicitly:
`workflow_dispatch` is `manual`, while the automatic
`vercel.deployment.success` repository dispatch is `ci`. During rollout to the
default-branch workflow, an absent explicit value derives the same result from
GitHub's event name. A rerun retains the original trigger classification and is
distinguished by the GitHub run attempt.

### Inspecting spans in PostHog

Find the GitHub Actions run ID and attempt first. The trace correlation value is
`<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`, for example `30116867811-1`.

In the Workspace PostHog project:

1. Open **Traces** and choose a time range that includes the E2E run.
2. Filter the service name to `deskohub-workspace-e2e`.
3. Filter the span attribute `e2e.run.id` to the correlation value.
4. Open the resulting trace and confirm it contains one root `e2e.run` span,
   one `e2e.case` span per executed case, and the expected `e2e.step` children.
5. Use native span duration for elapsed time. Compare case and step durations
   with `e2e.timeout_ms`; do not derive duration from log timestamps.
6. Use `e2e.execution_context` to separate `manual` and `ci` runs, and inspect
   `e2e.outcome` plus `e2e.failure.kind` when a span did not pass.

For scripted inspection, authenticate `posthog-cli` to the EU Workspace
project with a personal API key granting `tracing:read`. The public project
token used by E2E can ingest spans but cannot read them. Query the PostHog
management origin, `https://eu.posthog.com`, rather than the ingestion origin.

Use `POST /api/projects/{project_id}/tracing/spans/count/` for aggregate arrival
evidence and `POST /api/projects/{project_id}/tracing/spans/query/` for bounded
duration inspection. Scope both requests with:

```json
{
  "query": {
    "dateRange": {
      "date_from": "-1d"
    },
    "serviceNames": ["deskohub-workspace-e2e"],
    "filterGroup": [
      {
        "key": "e2e.run.id",
        "type": "span_attribute",
        "operator": "exact",
        "value": "<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>"
      }
    ]
  }
}
```

For the query endpoint, additionally set `rootSpans: false`,
`flatSpans: true`, and a bounded `limit`. Report only span counts, names,
durations, closed E2E attributes, and safe GitHub correlation values. Do not
dump full attribute/resource objects, exception events, credentials, preview
URLs, or provider/customer/reservation data. PostHog's query response represents
span attributes such as `e2e.timeout_ms` as strings; `duration_nano` remains the
native numeric duration.

Trace export passes through the same shared censoring logic as normal Workspace
logs. That shared boundary censors span attributes, event and link attributes,
exception details, and span status messages. The E2E instrumentation itself
adds only closed, code-owned values and never adds preview URLs, database or
provider identifiers, reservation/order/customer data, test contact fields,
raw errors, credentials, or artifact contents.

Export and shutdown are bounded and observational: PostHog availability must
not replace the E2E result. Without a project ingest token, local execution
remains usable without remote traces; the existing console progress output
remains available but is not the telemetry source of truth.

These spans cover every invocation that reaches `bun run test:e2e`. Failures
in earlier workflow setup such as target resolution, dependency installation,
or preview database migration remain represented by GitHub Actions rather than
the in-process suite telemetry.

For Nexi sandbox facts and cards, see
[`../../../packages/nexi/docs/TESTING_API.md`](../../../packages/nexi/docs/TESTING_API.md).
