# Workspace E2E suite orchestration

## Contents

- [Project graph](#project-graph)
- [Hosted-payment permit](#hosted-payment-permit)
- [Processes and browsers](#processes-and-browsers)
- [Fail-fast and cleanup](#fail-fast-and-cleanup)
- [Date shards and the coordination database](#date-shards-and-the-coordination-database)
- [Webhook replay permit](#webhook-replay-permit)
- [Dotypos capacity and stale reservations](#dotypos-capacity-and-stale-reservations)
- [Provider load](#provider-load)
- [Trace and annotation contract](#trace-and-annotation-contract)

## Project graph

Playwright Test owns ordering, scheduling, workers, browsers, and fail-fast admission. `playwright.e2e.config.ts` defines the graph; `scripts/account-e2e-graph.test.ts` and `scripts/workspace-e2e-scheduling.test.ts` assert it.

```text
checkout-setup (teardown: checkout-cleanup)
  ├─ checkout-cases (workers: 5; paid, non-payment, and referral cases)
  ├─ account-auth (serial account lane)
  ├─ administrator-access (queued after the case pools)
  ├─ email-campaign-recipient-preview (queued after the case pools)
  └─ access-code-creation (last in config, so queued last)
```

- Keep the global worker ceiling at six. It bounds whole cases, replacing the old reservation-start permit pool.
- Dependency phases are barriers: every phase boundary stops all workers and starts new ones. Prepare the run in the one `checkout-setup` test, never in separate dependency projects, because each extra preparation project delays the case phase. Every case-phase project depends on `checkout-setup`, and `checkout-cleanup` reconciles as its teardown.
- Inside `checkout-setup`, write the run context first. Then run preview readiness and fixture seeding concurrently, start cowork, meeting-room, and office availability preparation only after both finish (Calendar availability reads the seeded definitions), overlap provider preparation with all of them, and build and verify the plan last. Each keeps its own phase span.
- Register every checkout case statically in `e2e/playwright-checkout/case-catalog.ts`. `checkout-setup` asserts the prepared plan matches `workspaceE2ECaseIds`.
- Paid and non-payment cases share the one `checkout-cases` pool. The [hosted-payment permit](#hosted-payment-permit), not serial Playwright lanes, bounds Nexi sessions.
- Referral cases are non-payment pool cases. `cases.pw.ts` binds them and the paid `checkout-guest-referral` to their seeded run-scoped identities through `registerWorkspaceE2ECases`' `bindCase`; see [referral cases](referral-lane.md).
- Keep `checkout-cases` one worker below the global ceiling. Playwright can queue `account-auth` behind every `checkout-cases` test in the phase, and the cap leaves the account lane a worker from the first batch.
- Register `checkout-cases` cases alternating paid and non-payment, each longest median first, so about three hosted sessions are in demand at a time. Re-sort by deployed medians when you add cases.
- `access-code-creation` sits outside the checkout case catalog and planner. Never add its case to `workspaceE2ECaseIds`. It combines Playwright `page` and `context` fixtures with the shared `runtimeTest` fixtures (`runEffect`, `E2EDatabase`). It is the last project in the config, and Playwright queues top-level projects in config order, so it takes the first worker that frees up (today the account lane's) rather than a first-batch slot. Under `maxFailures: 1`, a case failure stops its admission; it keeps its own interruption-safe cleanup.
- `email-campaign-recipient-preview` and `administrator-access` follow the same admin-case pattern and sit before `access-code-creation`, so none takes a first-batch slot. All build on `e2e/admin-case.ts` (signed-out context, bypass priming, sanitized browser operations, finalized case, action barriers) and sign in through a seeded administrator ([fixtures](fixtures.md#administrator-sessions)); put further admin cases there instead of copying helpers.
- `administrator-access` (`e2e/administrators/administrator-access.pw.ts`) holds two short seeded-session cases with their own journal owners. `administrator-sign-in-return` asserts that a signed-out admin URL with a query answers 307 to the localized sign-in page with the encoded `returnTo`, that the browser shows the sign-in form there, and that a seeded administrator opening that `returnTo` sees admin content. `administrator-non-administrator-refusal` asserts that a seeded account without the grant gets a 404 document at `/en-US/admin` without a redirect.
- No E2E case consumes a real magic link that lands on an admin URL. The account lane's ledger already spends the whole budget (four sends, four verifications), and every one of its links must land elsewhere. The reauthentication account is deletion-pending, so it can't act as an administrator. The `returnTo` landing after a link or code is covered by the sign-in functional tests. A real-link admin case would need its own lane case (`account-admin-sign-in`, last in the catalog, `["send", "verify"]`) that waits out one quiet window. That adds up to ten minutes to the lane (`accountCase` already budgets one wait) and needs an explicit, documented allowance in `catalog.test.ts`.
- Keep Effect inside each Playwright test for domain workflows, semantic steps, tracing, provider coordination, cleanup, and finalizers. Don't reintroduce an Effect case aggregate, a reservation priority pool, or a custom browser launcher.

Run the synthetic scheduler harness from `apps/deskohub-workspace` with `bun run test scripts/workspace-e2e-scheduling.test.ts`. It runs the real graph once to pass and once with a checkout failure, and asserts the account lane and access-code queueing. Prove a graph change with it, not only a graph assertion. Synthetic results aren't deployed-run evidence.

## Hosted-payment permit

Unbounded hosted sessions produced Nexi sandbox error pages, and a one-session bound stretched the case phase past the case watchdog. Three sessions per suite is the measured operating bound, not a provider guarantee; three overlapping suites hold at most nine.

- Bound only the Nexi hosted portion of a paid case, never the whole case. Paid cases run their preparation and post-payment validation in the shared pool.
- Wrap the span from payment submission through the return to the checkout status page (for failed and cancelled cases, through the terminal-state preparation) in `WorkspaceE2EHostedPaymentPermitService.withPermit` (`e2e/coordination/hosted-payment-permit.service.ts`). The single [sandbox restart](nexi-sandbox.md#sandbox-restart) stays inside the same hold. Release it before `replay-payment-webhook` so it never nests with the webhook replay permit.
- Playwright workers are separate processes, so the permit is a FIFO ticket queue in the run's `e2e-artifacts/checkout/hosted-payment-permit/` directory, keyed by run ID. It doesn't use the coordination database, so manual and local runs enforce it too.
- `checkout-setup` creates the queue and its generation marker. The permit never recreates them; a missing or replaced marker fails every waiting and holding case.
- A finalizer releases the ticket after success, failure, timeout, or interruption, including while waiting.
- Reclaim a ticket only when its holder process is gone: the PID no longer runs, is a zombie, or has a different procfs start time (a recycled PID). Never reclaim on time; a frozen holder keeps its slot until the case watchdog or Playwright ends it.
- Any queue read or write failure, including the release, fails the case.
- The wait counts toward the case watchdog but not the hosted steps' semantic timeouts. Every admission logs `HOSTED PAYMENT PERMIT <operation> admitted after <s>s`; read those waits before you blame Nexi or the scheduler.
- Changing the capacity or widening the boundary needs the same five concurrent exact-SHA soak rounds as any provider-boundary change (see [Dotypos capacity](#dotypos-capacity-and-stale-reservations)).

## Processes and browsers

- `scripts/workspace-e2e.ts` runs the checkout config and `playwright.instant-navigation.config.ts` concurrently. Instant navigation takes no lease, doesn't depend on the checkout graph, writes a separate output directory, and fails the run after checkout finishes without triggering checkout fail-fast.
- Instant navigation's `administration-navigation` project depends on `administrator-setup`, which seeds one synthetic administrator (owner `instant-navigation-administrator`). It persists the run id and then the journal in the config's own `e2e-artifacts/instant-navigation/`, never the checkout suite's, because Playwright clears each config's output directory at start. Its teardown, `administrator-cleanup`, reconciles that journal. Each admin test signs in with its own short-lived session. Without `WORKSPACE_E2E_BASE_URL` (local `next dev`), these projects skip. The other navigation projects never wait for the setup.
- Build every child environment with `workspacePlaywrightProcessEnvironment` so each config gets its own transform cache. A shared cache can hand one config a half-written module.
- The launcher passes children only `toPlaywrightEnvironment(environment)`. The `no-raw-environment-in-e2e-launcher` Grit rule rejects `process.env` and `Bun.env` in `scripts/workspace-e2e.ts`. Elsewhere in TypeScript config files, use the app's typed `env` and declare config-owned inputs in the root environment schema.
- Never project app-only variables into E2E config or use app PostHog variables as E2E telemetry fallbacks; E2E telemetry uses only `WORKSPACE_E2E_POSTHOG_*`.
- Workers read shared preparation only from private, versioned, shape-checked files under the ignored artifact root.
- Playwright owns one browser per worker. The runner may create one isolated context per test but never launches or closes the browser. Capture failure diagnostics before closing the context. Playwright flushes HAR on context close, so close every context in a bounded finalizer before you sanitize or discard its raw HAR. Owned-reservation cleanup may overlap the browser branch; HAR stop still precedes context close.
- Each worker's E2E database pool holds at most two connections.

## Fail-fast and cleanup

- `maxFailures: 1` and `retries: 0`: Playwright stops admitting cases after the first failure.
- `checkout-setup` writes `run-context.json` before it leases or seeds anything. Keep every side effect after that write; the launcher skips cleanup recovery when no run context exists.
- Each running test owns its `CheckoutFlowState` values. Its finalizer may cancel only captured reservation IDs or an exact-order lookup. Write a private per-case cleanup journal before execution, and persist finalizer completion before the test settles.
- `checkout-cleanup` uses a minimal runtime that doesn't need provider-permit connectivity. It skips a second cancellation for journaled completions but still waits for their convergence. Only it may use the broad locale, product, and time lookup, and only for states whose exact finalizer didn't finish.
- A fail-fast suite can exit before Playwright schedules teardown. After a nonzero exit, the launcher runs `--project=checkout-cleanup --no-deps` once with a fresh output directory, keeping the original run context and journals. The suite stays failed even if recovery passes; never rerun ordinary cases during recovery.
- Keep the Playwright watchdog longer than the longest semantic case plus artifact and cleanup budgets (`workspaceE2EPlaywrightCheckoutTimeout`), so Effect finalizers win every timeout race.
- Propagate Effect's `AbortSignal` through the runner and close the interrupted case's context so browser work stops.
- Deduplicate cleanup targets and cancel independent Dotypos reservations concurrently, collecting every exit.
- A successful Dotypos cancellation is issued, not converged. Before releasing the date shard, poll the active-overlap read model that capacity validation uses until every cancelled ID is absent or cancelled, including finalizer cancellations (without cancelling them again). Absence from the generic reservation list isn't enough.
- The `suite-cleanup` phase span fails whenever cleanup fails.

## Date shards and the coordination database

Supported concurrency is three simultaneous exact-SHA runs (`workspaceE2EConcurrentRunTarget`).

- **Shards.** Cases use dates 14 to 90 days out, split into three round-robin weekday sequences. Partition the canonical weekday sequence by absolute date before filtering availability, so a changing provider snapshot or a run crossing midnight can't move a date between shards. Validate every selected date through the deployed availability route; never add an app query parameter or runner capacity mutation.
- **Per-run date use.** Ordinary open-space cases share a date up to four reservations (`workspaceE2EMaximumSameDateCoworkReservations`). Calendar-sale open-space dates and reserved-desk dates take one reservation each and stay distinct from the shared open-space dates and from each other. Meeting-room cases use distinct dates, including those a whole-day booking touches. The paid office case uses one Thursday-to-Friday range with the Thursday assigned through the shard.
- **Allocator.** The trusted `.github/actions/workspace-e2e-allocation` action leases a shard before dependency install. It's authored in TypeScript and Effect and committed as a dependency-free ESM bundle; rebuild with `bun --cwd apps/deskohub-workspace e2e:coordination:build-action`. The runner receives the one-based shard as `WORKSPACE_E2E_ALLOCATION_SHARD`; its identity fallback exists only for compatibility.
- **Database.** A separate long-lived Neon project, `workspace-e2e-coordination`, with no Vercel integration. Never coordinate through an app production, development, or preview database. Provision or migrate it from a trusted session with `WORKSPACE_E2E_COORDINATOR_ADMIN_DATABASE_URL` set only for that process: `bun --cwd apps/deskohub-workspace e2e:coordination:provision`.
- **Lease rules.**
  - Each transition locks the fixed pool row in a serializable transaction. PostgreSQL needs `SELECT` and `UPDATE` on the pool for `SELECT ... FOR UPDATE`.
  - A partial unique index is the one-owner-per-shard backstop. A generated identity is the FIFO ticket.
  - The owner is repository, run ID, and attempt. Keep an existing assignment for the same owner and prefer the PR-derived shard.
  - Retry only classified serialization failures.
  - Reclaim an owner only when `/actions/runs/{run_id}/attempts/{attempt}` reports `completed`. Fail closed on missing or failed lookups.
  - Never use a TTL as lease authority, because Dotypos has no fencing token. Release only your own owner; later acquisitions reconcile owners left by interruption.
  - A fourth contender waits in FIFO order and fails before setup with supported-concurrency context when its wait expires.
- **Credentials.** CI holds only the allocator's direct URL, never an admin URL or Neon API credential. Allocator jobs need `actions: read` and `contents: read` plus status publication, not repository writes. Never pass the allocator URL or role to exact-SHA code.
- Don't restore a global workflow lock on the Dotypos sandbox while the allocator and permits stay healthy.

## Webhook replay permit

The synthetic `replay-payment-webhook` step confirms the Dotypos hold and sends the paid-reservation emails through the production route. It's the one distributed boundary:

- Admit one replay across all suites with a transaction-scoped PostgreSQL advisory lock in the coordination database, through `WORKSPACE_E2E_PROVIDER_PERMIT_DATABASE_URL`.
- Treat the permit as load control, not provider-side fencing. A lost coordinator connection releases the lock while the replay's HTTP request may still run, so keep unique order and idempotency identities on every protected operation.
- Hold the lock for a one-second quiet cooldown after every success, failure, or interruption, so two emails per fulfillment can't form a shared Resend team burst. Never retry the webhook.
- Each worker runs one lock query at a time (worker-local semaphore), leaving a second pool connection free for interruption cancellation. The six-worker ceiling bounds the run-wide queue.
- CI sets `WORKSPACE_E2E_PROVIDER_PERMIT_REQUIRED=true`. Every parallel checkout run, including manual runs, fails closed without the permit URL; a worker-local fallback can't bound a suite-wide limit.
- The semantic step timeout starts after admission. The step span includes the wait, and the case watchdog bounds both.
- Keep hosted payment, genuine webhook delivery, work after the replay response, and unrelated provider calls outside the permit. Don't key it on step-name strings, extend it to later stages, or change its capacity without exact-run evidence.
- The permit role is SQL-created with connect-only access and no role memberships. Neon Console, CLI, and API roles inherit `neon_superuser` and are unsuitable. The provisioner refuses to commit if the role has elevated flags or memberships.
- Register the full permit URL plus host, database, user, and password with the process redactor before building its SQL Layer. The trace exporter censors `server.address` and `db.namespace`.

## Dotypos capacity and stale reservations

`bun --cwd apps/deskohub-workspace e2e:capacity` runs a read-only aggregate validator (`e2e/capacity.ts`) against the E2E Dotypos cloud in every CI run. It prints no identifiers. Each group must meet a provisioned minimum sized for the supported runs plus one headroom run (`workspaceE2EProviderHeadroomRuns`) and, where listed, a remaining minimum after peak overlapping active reservations:

| Group | Provisioned | Remaining |
| --- | --- | --- |
| `cowork:open-space`, no `monitor:` tags | 16 seats | 8 seats |
| `cowork:reserved-desk`, no `monitor:` tags | 4 seats | 2 seats |
| `cowork:reserved-desk` plus exactly one monitor option's `monitor:` tags, per option | 4 seats | 2 seats |
| `reservation:meeting-room` | 4 tables | 1 table |
| `reservation:office` | 1 table, 2 seats | Not checked |

Groups count only enabled, displayed tables with an ID and a positive seat count, and use the same candidate predicate as table assignment. Legacy `tier:basic`, `tier:plus`, and `tier:profi` tags are report-only and satisfy no group, so inventory tagged only with legacy tiers fails.

Use peak overlap, never a sum across unrelated dates, and never treat meeting-room seats as room concurrency. Query whole first and last candidate dates. Change table seats or rooms operationally in Dotypos, then rerun the validator; never change capacity from the runner.

`e2e:cleanup-stale` is dry-run by default and applies only with `--apply`, which the workflow passes when `cleanup_stale_e2e_reservations` is set on a manual dispatch. It cancels only reservations whose customer name has the `Workspace E2E ` prefix and a `delivered+…` email on the test domain or the legacy `resend.dev` simulator domain, and whose embedded timestamp is at least two hours old (the job timeout is 50 minutes). If any candidate's details can't be read, it cancels nothing. Don't request it during a load soak.

Before you raise supported concurrency or loosen a provider boundary:

1. Confirm the validator passes.
2. Start the supported number of exact-SHA previews together and repeat the soak at least five times with controls unchanged.
3. Confirm every run passes, cleanup converges to zero active E2E reservations, no shard runs out, and provider p95 doesn't regress.
4. Then narrow the boundary, locking only the shared resource.

## Provider load

- `pollUntil` keeps fixed spacing. Opt into `initialIntervalMs` backoff only for reads that aren't rate-limited (PostgreSQL). Dotypos-backed polls, including the availability route, keep fixed spacing because Dotypos answers bursts with 429.
- Interval-based availability in the app stays pending while a user is still editing its inputs and coalesces intermediate queries. Keep the immediate first query and the final selection. Parallel browsers otherwise multiply edits into enough Dotypos and Calendar loads to strand the last request.
- Preserve parallel payment coverage unless exact-run evidence shows a concurrency-specific failure.

## Trace and annotation contract

The wrapper exports an OTLP trace to PostHog under service `deskohub-workspace-e2e` and propagates its context to every worker.

- One root `e2e.run` span, fixed `e2e.phase` spans (readiness, fixture seeding, provider and cowork, meeting-room, and office availability preparation, case construction, per-case finalization, suite cleanup). The preparation phases all run inside the one `checkout-setup` test and stay separate spans, one `e2e.case` per case, and one `e2e.step` per semantic step.
- Fixed low-cardinality span names, code-owned IDs, native span duration, and `e2e.timeout_ms` for the configured timeout.
- Closed outcomes `passed`, `failed`, `timed_out`, `cancelled`; closed failure kinds `error`, `defect`, `timeout`. `e2e.execution_context` is `manual` or `ci`. `e2e.run.id` is `<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`.
- A failed replay step may add `e2e.failure.code` only after decoding it against the route's fixed error allowlist. Discard unknown bodies.
- Shard number and count are allowed numeric attributes. Never attach preview URLs, dates, provider or database identifiers, customer, order, or reservation data, raw errors, secrets, or artifact contents. Export goes through the same censoring as Workspace logs.
- Export and shutdown are bounded; PostHog availability never changes the E2E result. Without an ingest token, runs work without remote traces.

Emit one GitHub check annotation for the genuine failed or timed-out case after its finalizer completes. Include only the case ID, terminal step ID when known, closed outcome and failure kind, and an optional allowlisted failure code. Never annotate interrupted siblings.
