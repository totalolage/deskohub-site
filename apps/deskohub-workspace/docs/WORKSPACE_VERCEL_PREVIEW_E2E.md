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
  The dedicated E2E cloud must contain at least one active percentage discount
  from 0.01% through 90%. The upper bound keeps enough payable subtotal for
  stacked-discount and external-payment cases. The runner selects a usable
  group deterministically through the Dotypos API and fails closed when none
  exists.
- GitHub Actions variables `WORKSPACE_E2E_POSTHOG_PROJECT_TOKEN` and, when
  using a non-default ingest region, `WORKSPACE_E2E_POSTHOG_HOST` in the
  `workspace-checkout-e2e` environment. The token is the public project ingest
  token, never a management API key or secret.
- `EMAIL_PROVIDER=console` for Preview. Browser cases exercise the complete
  email workflow without making external delivery attempts or consuming the
  Resend plan. Keep `EMAIL_PROVIDER=resend` and `EMAIL_API_KEY` scoped to
  Production.
- The non-sensitive Preview-only
  `POSTHOG_FEATURE_FLAG_OVERRIDES={"calendar_sales":true,"customer_discounts":true,"discount_codes":true}`.
  Set this before the immutable Git preview is built; the runner never mutates
  deployment configuration or the real PostHog rollout state.
- `GOOGLE_CALENDAR_SALES_ID` must identify the dedicated Preview E2E sales
  calendar. Its long-lived all-day sale references discount UUID
  `454784dd-380b-43a1-bae7-cc070bf1aec2`. Keep that event immutable so parallel
  happy-path cases cannot interfere with one another.
- `VERCEL_AUTOMATION_BYPASS_SECRET` for Deployment Protection.

Do not use production Nexi, Dotypos, or database credentials in Preview.
Do not add callback-origin or BotID test-bypass overrides. Non-production
callback origins derive from the deployment's `VERCEL_URL`; production derives
from `VERCEL_PROJECT_PRODUCTION_URL`.

Workspace appends the protection-bypass query parameter to preview Nexi result
and notification URLs when configured. Browser navigation establishes the
bypass cookie, readiness checks use the bypass header, and direct Nexi webhook
replays send the `x-vercel-protection-bypass` header.

## Parallel execution contract and rollout state

The initial timing baseline is exact-SHA run
[`30841881638`](https://github.com/totalolage/deskohub-site/actions/runs/30841881638)
at `549e3f34696d3b1ae2c46da139c89f8c2902b475`. `Run checkout E2E` took
`4m50.783s`; 30 independent cases overlapped for about `2.6m`, the serialized
Calendar pricing-change case added about `1.3m`, and preparation, readiness,
finalization, and cleanup accounted for the remainder. The full job took
`5m45s`, about `55s` of which was setup. This is the comparison point for phase
spans and the workflow timing summary.

The in-run contract is:

- preview readiness requests, read-only availability preparation, discount
  fixture seeding, cleanup discovery, and independent cancellations overlap;
- the first case failure signals siblings before its own finalizer, so sibling
  browser and provider work is interrupted promptly;
- every case owns its checkout states and cancels captured Dotypos reservations
  in its finalizer using only a captured reservation ID or an exact order
  lookup; HAR stop still precedes browser close;
- suite cleanup reconciles interrupted or incompletely captured states and is
  the only place allowed to use the broader locale/product/time lookup. It
  waits for every successfully cancelled reservation to leave Dotypos active
  inventory before releasing the sandbox lock, including reservations already
  cancelled by case finalizers;
- Calendar pricing-change scenarios remain one serialized tail until two
  separate immutable operational events and separate preview-owned definitions
  have been provisioned for quote-change and payment-change. The regression
  suite proves distinct event identities and dates do not share transient cache
  mutations, but that does not replace provisioning the real Preview fixtures
  and an exact-SHA parallel run.

Customer-discount cases mutate only their unique customer's group assignment;
they never mutate the selected Dotypos discount-group definition. Nexi order
and idempotency identities remain unique per checkout, and there is no
suite-wide hosted-payment semaphore without evidence of a provider-specific
concurrency failure.

Cross-run concurrency has a target of three simultaneous healthy exact-SHA
runs. Before provider setup begins, an isolated coordinator leases one of three
static absolute round-robin weekday sequences from the 14-to-90-day candidate
range. One fixed Git ref stores the three owners and FIFO queue in a linear
commit history. Each transaction appends to the exact observed tip and moves the
ref without force. When contenders write from the same parent, only one update
can fast-forward; the others reload the winner and retry. This is the atomic
authority. Fixed commit-status contexts remain safe diagnostics only.

The owner token contains the workflow run ID and attempt. Allocation reclaims
an owner only after the Actions API reports that exact attempt terminal, and
finalization removes only its own token. Interrupted or superseded workflows
therefore cannot strand capacity, and a delayed finalizer cannot release a
replacement owner. The allocator has `contents: write` only in isolated jobs
that check out the workflow-owned action with persisted credentials disabled.
The exact-SHA application checkout and test job retain read-only contents
permission. The PR identity selects the preferred shard; the allocator chooses
another free shard when necessary and preserves a fourth contender in FIFO
order until a shard is released or its bounded preparation wait expires.

Assign weekday ownership before filtering the deployed availability response so
changing provider snapshots cannot shift a date between shards. Interleaving
the fixed candidates also avoids starving one run when unavailable dates cluster
in a contiguous part of the range. The checked-out runner receives the leased
one-based shard through `WORKSPACE_E2E_ALLOCATION_SHARD`; its identity fallback
exists only for rollout compatibility.

Cowork and meeting-room candidates remain validated through the deployed
availability route. Basic cases deliberately use at most four same-date
reservations; Plus and every monitor-specific Profi pool use at most one.
Calendar-sensitive Plus and Profi dates remain distinct from the Basic dates
and from one another. Meeting-room cases use distinct dates within the run's
shard, including the dates touched by a whole-day reservation.

The job-level `workspace-e2e-dotypos-sandbox` lock remains the default while
rollout evidence is collected. A controlled `workflow_dispatch` soak may set
`allow_concurrent` to exercise the atomic allocator without changing ordinary
CI. Remove the default lock only after the capacity checklist and five three-way
concurrent soaks pass.

### Dotypos capacity checklist

Run the read-only aggregate validator only against the dedicated testing cloud
from an environment that already satisfies the Workspace E2E environment
contract:

```bash
bun --cwd apps/deskohub-workspace e2e:capacity
```

The command uses the generated Dotypos table and reservation contracts, bounds
the reservation lookup to active overlaps in the candidate interval, and
prints no table, reservation, customer, or provider identifiers. It reports
active-visible and assignable table counts, the sorted seat-count multiset,
total seats, and active overlapping reservation totals for these groups:

- `tier:basic`: at least 16 aggregate seats;
- `tier:plus`: at least 4 aggregate seats;
- every `tier:profi` monitor-tag combination: at least 4 aggregate seats for
  each exact tag set; a generic Profi table does not satisfy a specific set;
- `reservation:meeting-room`: at least two active visible assignable tables.

The testing-cloud inventory was operationally provisioned on 2026-08-04 with
16 Basic seats, 16 Plus seats, four seats for every exact Profi monitor option,
and four meeting-room tables. Treat these as expected aggregates, not verified
evidence, until the protected workflow validator confirms that every table is
active, visible, assignable, and exactly tagged. No provider identifiers belong
in this document or the validator output.

The cowork budgets cover the supported three runs plus one run of inventory
headroom. Meeting-room seat counts do not increase concurrency because normal
assignment requires an empty table; date sharding supplies the primary
isolation and the second room supplies failure/cleanup headroom. The repository
Dotypos contract exposes table reads, not a runner-owned capacity mutation.
Change testing-table seats or provision rooms operationally, then rerun the
validator. Never change shared table capacity from the test runner.

Before changing the workflow lock:

1. Confirm the validator passes and investigate any active overlapping
   reservations using safe aggregate diagnostics only.
2. Start three exact-SHA previews simultaneously and repeat the concurrent soak
   at least five times while the ordinary CI lock remains unchanged.
3. Verify every run passes, cleanup converges to zero active E2E reservations,
   no allocation shard exhausts, and provider/function p95 does not regress.
4. Only then partition or remove the global lock. If one mutable resource
   remains, lock only that resource rather than the whole job.

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

## Discount fixtures

Before browser cases start, the runner upserts source-neutral discount
definitions, targets, and code configurations into the exact preview database.
It does not insert application or redemption history: those records must be
created only by the deployed checkout lifecycle.

The stable Calendar event and its database definition cover Calendar-only and
Calendar-plus-code checkout. Dedicated immutable code rows cover valid,
inactive, not-started, expired, customer-ineligible, and product-ineligible
submission. A separate case-owned code is moved past its exclusive
`valid_until` after it is shown on the summary and before payment; the browser
must receive `pricing_changed`, and the database must contain no payment
attempt, application, or claim.

Customer fixtures are created through the normal Dotypos customer API. The
runner discovers a deterministic active partial-percentage group in the E2E
cloud, derives the expected application from its actual percentage, then
assigns customers through an ETag-protected customer patch. The browser matrix
covers customer-only, customer-plus-code, Calendar-plus-customer, and all three
sources together. A separate customer's group is cleared after summary
creation; payment must return `pricing_changed`.

The stable Calendar definition targets Plus, Profi, and the one-hour meeting
room. Calendar pricing-change edge cases use Profi while all Calendar happy
paths use Plus. In one serialized top-level case, the runner removes only the
Profi target after reservation-page advertisement and again after
signed-summary creation. Each scenario restores the Profi target in an
interruption-safe finalizer. Both must show the normal pricing-change state with
no payment attempt. The Calendar event itself remains immutable, and Plus and
meeting-room eligibility are never mutated, so every other top-level case
continues to run in parallel.

Calendar all-day expiry is tied to the selected reservation date, so a browser
case cannot safely wait across its real Prague-midnight boundary. Deterministic
browser coverage removes the selected product from the event's stored
definition at the same provider boundary.
Provider tests use Effect's test clock for the literal exclusive-end instant,
including the rule that a cached discovery cannot outlive that instant.

Capacity and one-redemption-per-customer cases first complete a real internal
zero-total checkout, then exercise a second customer or reservation against
the consumed code. Capacity limits advance from retained active audit history
on reruns; the suite never deletes application or redemption records.

Every case uses a unique customer. Dates come from the run's deterministic
allocation shard. Basic cases may share a date up to the documented capacity
of four; Plus and Profi Calendar dates stay disjoint from Basic and from one
another. The suite runs independent case fibers with uncapped fail-fast Effect
concurrency. Reservation-start steps alone share six runner-owned permits from
navigation through pay-page arrival. Two exact-SHA runs with unbounded starts
showed provider-backed availability responses queueing beyond the existing UI
boundary in different cases. Reducing the boundary from six to four repeated
the same pre-submit meeting-room readiness failure while leaving fourteen cases
queued after 4.8 minutes, so four did not improve reliability and could not meet
the existing case watchdogs. The checked-in limit is therefore six. The narrow
boundary releases at pay-page arrival, before hosted payment, webhook,
fulfillment, assertions, and cleanup, which all remain parallel. The permit
pool prioritizes queued starts by the owning case watchdog and keeps equal
deadlines FIFO, so shorter terminal scenarios cannot be stranded behind longer
checkout cases when browser diagnostics make them reach the pool later. All
case fibers still launch immediately and participate in the same fail-fast
aggregate. Direct database assertions share one runner-owned pool capped at ten
connections.
Before allowing three concurrent runs, revalidate the aggregate eighteen-start
ceiling in the required soak and lower the per-run limit if provider p95 or
throttling regresses. Do not make an edge case mutate a fixture consumed by
another case.

### Discount coverage matrix

Keep the discount suite split by the boundary that needs evidence. Browser E2E
proves customer-visible behavior and the resulting persisted lifecycle state.
Deterministic provider and transaction tests retain exhaustive malformed-input,
provider-failure, clock-boundary, and write-race coverage that would be unsafe
or unreliable to manufacture through shared external systems.

| Scenario | Browser E2E evidence |
| --- | --- |
| Calendar, customer, or code individually | Completed payment, displayed generic label, persisted application |
| Calendar + customer, Calendar + code, or customer + code | Completed payment and applications persisted in source-neutral order |
| Calendar + customer + code | Completed payment and all three applications persisted in order |
| Code reduces total to zero | Internal paid attempt, redeemed claim, fulfillment, no Nexi page |
| Invalid syntax, unknown, inactive, not started, or already expired code | One generic field error; existing summary remains usable; no payment state |
| Customer-ineligible or product-ineligible code | One generic field error; no application or claim |
| Capacity exhausted or already redeemed by the same customer | A real first redemption followed by the rejected customer attempt |
| Code expires after summary but before Pay | `pricing_changed`; no payment attempt, application, or claim |
| Calendar sale disappears after advertisement but before quote | Refreshed summary with `pricing_changed`; no payment state |
| Calendar sale disappears after summary but before Pay | `pricing_changed`; no payment state |
| Customer discount changes after summary but before Pay | `pricing_changed`; no payment state |

Provider tests cover malformed Calendar events and definitions, partial
resolution, Calendar and database failures, half-open Calendar/code expiry,
and cache expiry. Checkout lifecycle tests cover atomic claim-admission races,
terminal-state races, provider failures, and rollback. Do not replace those
deterministic tests with external E2E mutations.

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

Invoke a real run from the repository root with
`bun turbo test:e2e --filter=deskohub-workspace`. Turbo invokes the Workspace
package's E2E script directly. The runner does not import generated translations,
so the real E2E task does not depend on `i18n:compile`.

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
fail-fast concurrency, scoped browser sessions,
cancellation propagation, bounded finalizers, case watchdogs, and discrete
semantic-step timeouts.

## Suite telemetry

The Bun E2E process exports an OTLP trace to PostHog under its own
`deskohub-workspace-e2e` service name. One root `e2e.run` span contains fixed
`e2e.phase` spans for preview readiness, fixture seeding, cowork/meeting-room
availability preparation, case construction, the independent and
shared-fixture phases, per-case finalization, and suite cleanup. It also
contains an `e2e.case` child for every case, and every semantic step is an
`e2e.step` child of its case. Span names are fixed and low-cardinality; phase,
case, and step IDs are code-owned attributes. The allocation shard and shard
count are bounded numeric attributes; provider identifiers, selected dates,
and preview URLs are not trace attributes.

PostHog's native span duration is the authoritative elapsed time. Case and step
spans also record their configured `e2e.timeout_ms`, which allows actual
duration to be compared with the watchdog that governed the operation. Terminal
attributes use only the closed outcomes `passed`, `failed`, `timed_out`, and
`cancelled`, plus the closed failure kinds `error`, `defect`, and `timeout`.
The exact target SHA and GitHub run correlation values are included when
available.

A reservation-start step's span includes time waiting for one of the six
runner permits. Its semantic step timeout begins only after admission; the case
watchdog still bounds the complete queued and active lifetime. This keeps a
healthy provider operation from losing its full timeout merely because another
case is using the documented provider-capacity boundary.

Fixture seeding completes before availability preparation because Calendar
availability resolves the seeded discount definition. Once that transaction
commits, cowork and meeting-room availability preparation run concurrently.

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

### Investigating a failed run

For any failure that reached the Workspace E2E runner, start with the exported
trace:

1. Record the exact GitHub run ID and run attempt, then query
   `e2e.run.id = <GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`.
2. Find the `e2e.case` whose `e2e.outcome` is `failed` or `timed_out`, then find
   its terminal non-passing `e2e.step`.
3. Compare that step's native duration with `e2e.timeout_ms` and note its closed
   `e2e.failure.kind`. This identifies whether the failure was an immediate
   error or defect, or a wait that exhausted its intended boundary.
4. Use the case and step IDs to inspect only the matching GitHub log section and
   the failed case's browser snapshot, HAR, and database assertion artifacts.
   The trace identifies where and when the run failed; those artifacts explain
   the page, request, or persisted state at that boundary.
5. Form a specific failure hypothesis before rerunning. A rerun is validation,
   not the first diagnostic step, and a repeated failure requires a regression
   test and underlying fix.

Do not dump full spans or artifact payloads. Apply the safe reporting boundary
below and report only correlation values, span names, durations, configured
timeouts, closed outcomes/failure kinds, and the minimum artifact facts needed
to explain the failure.

Failures before the E2E process starts—target resolution, dependency
installation, preview-database resolution, capacity validation, or
migration—do not produce suite spans. Diagnose those from the responsible
GitHub Actions step. The workflow adds a setup timing table to its Actions
summary for Bun setup, repository dependencies, Neon resolution, aggregate
Dotypos capacity validation, migration, the pinned `agent-browser` CLI, and
browser/system dependencies. These operations remain sequential until a
supported prepared runner image or cache can overlap them without background
shell jobs, shared-install locks, or hidden failures.

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

These spans cover every invocation that reaches the Workspace E2E runner.
Failures in earlier workflow setup such as target resolution, dependency
installation, or preview database migration remain represented by GitHub
Actions rather than the in-process suite telemetry.

For Nexi sandbox facts and cards, see
[`../../../packages/nexi/docs/TESTING_API.md`](../../../packages/nexi/docs/TESTING_API.md).
