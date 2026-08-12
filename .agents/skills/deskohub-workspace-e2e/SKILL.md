---
name: deskohub-workspace-e2e
description: Workspace protected-preview, checkout, Nexi, webhook, database, and browser E2E testing.
---

# Deskohub Workspace E2E

## Contents

- [Establish the workflow](#establish-the-workflow)
- [Preserve E2E invariants](#preserve-e2e-invariants)

## Establish the workflow

Treat [the Workspace E2E entry point](../../../apps/deskohub-workspace/scripts/workspace-e2e.ts), [Playwright configuration](../../../apps/deskohub-workspace/playwright.e2e.config.ts), and nearby `e2e/playwright-checkout/**` projects, cases, and services as the executable source of truth for automated runs. Inspect the relevant project, case, and service before running or changing the suite.

Read only the supporting documentation needed for the scenario:

- Preview environment, deployment protection, callbacks, and state checks: [preview workflow](references/preview-workflow.md).
- Current checkout persistence and lifecycle: [checkout lifecycle](../deskohub-workspace-checkout/references/lifecycle.md).
- Nexi sandbox behavior and test inputs: [Nexi sandbox](references/nexi-sandbox.md).

Distinguish automated-runner behavior from manual procedures before treating a difference as stale. If documentation conflicts with the runner about an automated run, follow the runner and update the stale documentation in the same change.

## Preserve E2E invariants

- Before trusting generated copy or changing assertions based on message text, run `bun turbo i18n:compile --filter=deskohub-workspace` from the repository root. Paraglide output can be stale relative to `features/i18n/messages/*.json`.
- Put database integration assertions inside the normal E2E runner and use its
  scoped `E2EDatabase` service, which connects to the workflow-injected direct
  preview URL. Do not add a dedicated package script, Turbo task, test-file
  naming convention, environment switch, or case-specific database allowlist
  for those assertions.
- Treat email-provider secrets that exist only in Vercel as intentionally unavailable to local E2E. Validate delivery through Vercel runtime or webhook evidence, and validate email body content with the fake transport renderer.
- Run full E2E only against the ordinary protected Vercel Git preview for the exact committed and pushed SHA. Use the immutable deployment URL from `vercel.deployment.success` or an explicitly supplied workflow-dispatch input; never scrape the PR comment or substitute a mutable branch/custom-domain alias. For manual dispatch, fail before the test job unless GitHub deployment metadata records that origin as a successful Workspace deployment for the exact target SHA.
- Treat `WORKSPACE_E2E_BASE_URL` and its integration-created Neon preview branch as one target. Resolve and migrate the validated `preview/<internal-head-ref>` branch after the preview succeeds, pass its pooled URL to runtime checks and its direct URL to migrations, assertions, and the allowlist, and fail closed rather than falling back to production or shared development.
- Do not deploy or mutate Vercel from the E2E runner. Uncommitted local code has no externally reachable Git preview and must not be described as tested through a previously built preview.
- Keep database assertions on the canonical catalog currency stored in local payment attempts. A non-production Nexi sandbox currency override applies only to Nexi request arguments and must not change the E2E expectation for persisted payment facts.
- Let Bun load dotenv files before the E2E entry module executes, then treat
  `e2e/e2e-env.ts` as the suite's only `process.env` boundary. Select, validate,
  and decode every runner-owned variable there once; inject the immutable typed
  configuration into telemetry, Layers, datasource configuration, and child
  command construction. Keep all E2E timeouts in the checked-in
  `e2e/timeouts.ts` configuration; do not add environment-variable overrides.
  Do not project application-only variables or use app-client PostHog variables
  as E2E telemetry fallbacks.
- In TypeScript configuration files outside that dedicated runner boundary, use
  the application's typed `env` instead of reading `process.env` directly, and
  declare any configuration-owned inputs in the root environment schema.
- Remember that repository-dispatch workflow configuration is evaluated from the default branch even when the job checks out an exact PR SHA. Do not make exact-SHA validation depend on changing a workflow-level environment value in the same PR; keep canonical expectations in the checked-out runner code or supply them through an already-compatible dispatch contract.
- When `test:e2e` runs through Turborepo, add every runner-owned workflow
  variable to that task's `passThroughEnv`. A workflow step can see an
  allocator or coordination value while the E2E child process silently loses
  it under Turborepo's strict environment filtering; test the workflow-to-task
  propagation boundary whenever adding one.
- Do not add runtime branches, query parameters, or other production behavior that bypasses the normal application path for E2E. Establish the required fixture state through approved integrations, then exercise the same route and workflow a real request uses.
- For customer-account magic links, use Neon's signed, branch-scoped `send.magic_link` webhook against the Auth integration on the already resolved preview branch. Do not query Neon-owned verification tables or create sessions directly. Restore the prior webhook configuration in a finalizer, redact the link and token before they can reach logs or artifacts, and treat SMTP delivery as a separate production-provider check because subscribing to this event replaces built-in email delivery.
- Keep Vercel Deployment Protection enabled. Use its automation-bypass cookie/header/query flow for browser navigation, preview callbacks, readiness checks, and webhook replays. BotID is a separate production-only application concern; read the BotID skill before changing that boundary.
- When priming the Vercel automation-bypass cookie, request a stable public asset that the app actually ships and require a successful response. A missing asset returns 404 even after a valid bypass, so it cannot distinguish protection failure from an invalid probe path.
- Use ordinary document links for cross-locale switching rather than Next.js client-router links. Locale is server-owned global context and the Workspace proxy persists its cookie for localized requests; cross-locale RSC prefetches and client transitions can race or fail to commit the selected locale. Keep this invariant shared across full, mobile, and minimal headers rather than fixing one presentation in isolation.
- For dynamically rendered forms, wait for the relevant framework handler to be hydrated before interacting; do not use network idle as the readiness signal because analytics traffic can keep it open. Then use Playwright locators and browser-native fill or keyboard operations so framework handlers receive trusted interactions. Select the actual control by accessibility role rather than a wrapping label. Prefer a stable app-owned id or form-scoped selector for critical activation when one exists. When a provider page requires an accessibility snapshot fallback, capture a fresh Playwright AI snapshot after hydration, resolve its `aria-ref` immediately, and do not reuse the reference after intervening DOM changes. Do not replace native form submission or link navigation with an evaluated DOM click.
- For tooltip assertions, wait for the trigger's focus handler, center it
  instantly in the viewport, wait for layout to settle, and focus it with the
  browser's native focus command. Assert Radix tooltip content through the
  trigger's `aria-describedby` target: the visible overlay structure is an
  implementation detail, while that relationship is the accessibility
  contract. Do not add a `Shift+Tab`/`Tab` round trip after focusing a known
  trigger; the browser can move to a different control. Do not paper over a
  missing interaction by increasing the overlay wait.
- Keep evaluated browser scripts that prepare navigation-producing forms side-effect free with respect to submission. An evaluated DOM click can navigate successfully while leaving the driver command blocked on the destroyed execution context. Return from preparation first, then focus the hydrated form-scoped submit control and activate it with a separate native keyboard command before polling the destination URL. A bounded preparation script may activate the existing production advertised-price retry control when that selected-query error control is rendered: the retry is read-only, must not reset the preparation deadline, and must never become a retry of reservation submission or another state-creating operation.
- For client-rendered hover or focus interactions, wait for the specific React event handler used by the component, not merely for a React props marker. A partially hydrated element can expose React metadata before Radix or another composed primitive has installed the handler that opens its transient content.
- Keep UI- or provider-backed preparation separate from the state-creating native activation. Start only side-effect-free preparation in a short Playwright evaluation, retain its bounded status in the page, poll that status under the existing semantic timeout, and activate the form only after preparation succeeds. Preserve preparation errors and do not increase timeouts or retry checkout/payment creation to hide a browser transport limit.
- Let Playwright Test own preparation ordering, case scheduling, worker
  processes, browser processes, fail-fast admission, and the shared-fixture
  tail. Register every case statically in the checked-in catalog and assert the
  prepared case plan matches it before execution. Use project dependencies for
  readiness, fixture seeding, parallel availability and provider preparation,
  plan construction, independent cases, the Calendar mutation case, and final
  reconciliation. Keep the global worker ceiling at six: it replaces the old
  reservation-start permit pool with a stricter whole-case bound. Put every
  hosted-payment case in one of exactly three serial Playwright lanes so at most
  three hosted sessions run per suite while non-payment work can use the other
  workers. Do not reintroduce an Effect case aggregate, suite-local hosted
  semaphore, reservation priority pool, or browser launcher. Effect remains
  inside each Playwright test for domain workflows, semantic steps, tracing,
  provider coordination, cleanup, and interruption-safe finalizers. The
  synthetic `replay-payment-webhook` step is the remaining measured distributed
  boundary. A three-way
  exact-SHA round failed all runs when a suite-local semaphore still allowed
  three aggregate Nexi replays, so admit one replay globally with a
  transaction-scoped PostgreSQL advisory lock in the dedicated coordination
  database. Every parallel Playwright checkout run, including manual runs, must
  fail closed without the direct coordination URL; a worker-local fallback
  cannot enforce a suite-wide limit across Playwright processes. Keep a
  worker-local Effect semaphore so each worker issues only one
  lock query at a time and a second SQL-pool connection remains available for
  interruption cancellation; the three payment lanes bound the run-wide queue.
  Use a separate direct URL whose SQL-created role
  has database connectivity only and no schema or table privileges;
  never expose the allocator URL or role to exact-SHA code. The five-round
  three-way soak completed with the distributed permit required on every run.
  Sustained three-way replay queues later
  produced sequential HTTP 500 responses even though the advisory lock proved
  there was no overlap. Keep a one-second quiet cooldown inside the permit after
  every replay exit so the synchronous fulfillment's two email sends cannot
  turn multiple suites into a shared-team rate burst. The cooldown must also run
  after failure or interruption; do not retry the webhook. Do not include
  hosted-page payment, genuine webhook delivery, work after the synthetic replay
  response, or unrelated provider work in that boundary. The semantic step
  timeout begins after
  admission while its trace duration includes permit wait and the case watchdog
  bounds both wait and execution. Do not key this boundary from step-name strings, expand it to
  later checkout stages, or change its capacity without exact-run evidence.
  Deduplicate cleanup targets and cancel independent Dotypos reservations
  concurrently while collecting every cleanup exit. Preserve parallel payment
  coverage unless exact-run evidence demonstrates a concurrency-specific failure.
- Treat a successful Dotypos cancellation response as issued, not converged.
  Before suite cleanup releases the sandbox boundary, poll the same active
  reservation inventory consumed by availability until every successfully
  cancelled ID is absent or cancelled. Include case-finalizer cancellations in
  this bounded convergence check without cancelling them a second time.
- Configure Playwright with `maxFailures: 1` and no retries so it stops admitting
  new cases after the first failure. Each already-running Playwright test owns
  its `CheckoutFlowState` values and may cancel only captured reservation IDs or
  an exact-order lookup in its finalizer. Write a private per-case cleanup
  journal before execution, then persist exact-finalizer completion before the
  test settles. The teardown project must use a minimal runtime independent of
  provider-permit connectivity, skip a second cancellation for journaled
  completions, and still wait for their convergence. Reserve the broad
  locale/product/time fallback for states whose exact finalizer did not finish,
  after every dependent project has stopped. Keep Playwright's outer watchdog
  longer than the longest semantic case plus artifact and cleanup budgets so
  Effect finalizers win every timeout race.
- Keep interval-based availability pending while a user is rapidly editing its inputs, and coalesce intermediate queries before they reach the provider-backed route. Parallel meeting-room browsers can otherwise multiply a date, time, and duration change into enough overlapping Dotypos and Calendar inventory loads to strand the final availability request. Preserve the immediate initial query and the final selected interval rather than serializing whole E2E cases or weakening the readiness assertion.
- Seed source-neutral discount definitions and codes only in the exact preview database before Playwright admits availability preparation or cases. Calendar-backed availability resolves the long-lived event's stored discount definition, so it reads those seeded rows even though provider discovery itself is read-only. After the seed project commits, let Playwright run cowork, meeting-room, and office availability tests in parallel while provider preparation runs in its sibling project. Keep the dedicated long-lived Calendar event immutable. When a pricing-change case must mutate its stored definition, isolate it on a product identity unused by happy paths, keep it in the Playwright project that depends on every independent-case project, serialize the related mutations inside that case, and restore the target with an interruption-safe finalizer. Calendar discovery caches resolved definitions by date, so a concurrent request for another product can otherwise preserve the transient target state. Never mutate a target consumed by another parallel case.
- Lease one partition of the fixed 14-to-90-day candidate range before
  constructing cases. Coordinate owners through the dedicated long-lived Neon
  coordination database, never an application production, development, or
  integration-owned preview database. Serialize state transitions by locking
  the fixed pool row in a serializable transaction. PostgreSQL requires both
  `SELECT` and `UPDATE` on the pool table for `SELECT ... FOR UPDATE`, even
  though the allocator never changes the pool definition. Retain a partial
  unique index as the one-owner-per-shard collision backstop. Persist a generated
  queue identity as the true FIFO ticket, preserve an existing assignment for the
  same repository/run/attempt owner, and retry only classified transaction
  serialization failures. Query the exact GitHub workflow attempt endpoint,
  reclaim only attempts confirmed `completed`, and fail closed on missing or
  failed status lookups. Never use a TTL as lease authority because Dotypos has
  no fencing token. Release only the exact finalizing owner; later acquisitions
  reconcile terminal owners left by interruption. Keep only the least-privilege
  direct runtime URL in the `workspace-checkout-e2e` environment, with no admin
  URL or Neon API credential in CI. Allocator jobs need `actions: read` and
  `contents: read`, not repository writes. Author the action in TypeScript and
  Effect and commit its dependency-free ESM bundle so allocation can run before
  repository dependency setup. Use the PR identity for the preferred shard and
  choose another free shard when needed. A bounded fourth contender may wait in
  FIFO order and must fail before setup with supported-concurrency context if
  the wait expires. The runner may
  retain its deterministic identity fallback only for rollout compatibility;
  concurrent CI must supply a coordinated shard. Validate every selected date
  through the deployed availability route; do not add an application query
  parameter or runner capacity mutation. The ordinary Dotypos workflow lock was
  removed only after aggregate pool provisioning and five successful
  three-way exact-SHA rounds proved the documented target; do not restore a
  global lock while the allocator and narrow measured permits remain healthy.
  Capacity
  preflight must check both physical inventory and capacity remaining after
  peak overlapping active reservations; never sum reservations on unrelated
  dates or treat meeting-room seats as room concurrency. Query the whole first
  and last candidate dates instead of preserving the preflight's current clock
  time at either boundary.
- Suppress database and provider identity in E2E output at both boundaries:
  register the complete coordinator URL plus host, database name, user, and
  password with the process redactor before building its SQL Layer, and censor
  `server.address` and `db.namespace` in exported OpenTelemetry attributes.
  SQL-created coordination roles must have no elevated role memberships; Neon
  Console/CLI/API-created roles inherit elevated membership and are unsuitable
  for the exact-SHA provider-permit capability.
- Partition the canonical weekday candidate sequence by shard before filtering
  provider availability. Keep that ownership static when availability changes;
  partitioning the returned available dates can reindex a later date into a
  different shard during concurrent snapshots. Base ownership on the absolute
  date so runs crossing midnight retain the same owner. Use round-robin weekday
  sequences rather than contiguous date bands so clustered unavailability does
  not starve a run that the full candidate range could support.
- Let Playwright own one browser per worker. The compatibility runner may create one isolated context for the current Playwright test, but it must never launch or close the worker browser. Capture diagnostics for the genuine failure before closing its context. Playwright flushes HAR when the context closes, so use bounded finalizers to close every failed, completed, or interrupted context before sanitizing or discarding its raw HAR. Keep read-only instant navigation as an independent fully parallel project in the same Playwright graph so it shares CI setup and runs alongside checkout preparation without depending on it. Within checkout case finalization, let owned-reservation cleanup overlap the browser branch while preserving HAR stop before context close.
- Confirm Dotypos cancellation convergence through the same active-overlap read
  model used by capacity validation. Absence from the generic reservation list
  is not sufficient evidence that provider availability has released the seats.
- Express each case as named semantic steps with a focused timeout (navigation, UI transition, provider transition, or datasource convergence), plus a generous case watchdog. Avoid using a single checkout-wide timeout for every browser command and poll.
- Preserve the E2E OTLP trace contract when changing orchestration. Emit one
  root run span, fixed phase spans, one child span for every case, and one child
  span for every semantic step. Phase IDs cover readiness, fixture seeding,
  invoice persistence, provider preparation, cowork, meeting-room, and office
  availability preparation, case construction, per-case finalization, and
  suite cleanup. Use fixed low-cardinality span names, native span duration,
  the configured timeout as a numeric attribute, closed outcome/failure-kind
  values, and the same shared censoring boundary as normal Workspace logs. Keep
  the execution context a closed `manual | ci` value, use only code-owned
  case/step IDs and safe GitHub correlation metadata, and never attach preview
  URLs, provider or database identifiers, customer/order/reservation data, raw
  errors, secrets, or artifact contents.
  A failed synthetic Nexi replay may add `e2e.failure.code` only after decoding
  the route's fixed application error allowlist. Discard unknown bodies and
  arbitrary provider values instead of attaching or logging them.
- When an in-process E2E case fails, inspect its exported PostHog trace before
  diagnosing from console output or rerunning. Correlate the exact GitHub run
  and attempt as `<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`, then find the failed or
  timed-out `e2e.case` and its terminal `e2e.step`. Compare native span duration
  with `e2e.timeout_ms`, inspect only the closed outcome/failure attributes, and
  use that timing and step boundary to decide which bounded GitHub log section,
  browser snapshot, HAR, or database assertion to inspect next. Artifacts remain
  complementary evidence for page and request state; do not replace trace-first
  triage with an undirected artifact dump. Setup failures before
  `bun run test:e2e` have no suite spans and must still be diagnosed from the
  responsible GitHub Actions step.
- Emit one GitHub check annotation for the genuine failed or timed-out case
  after its finalizer completes. Include only the code-owned case ID, terminal
  semantic step ID when known, the closed outcome/failure-kind values, and an
  optional failure code from the fixed code-owned diagnostic allowlist.
  Never annotate interrupted siblings, unknown diagnostic values, raw errors,
  provider data, customer data, URLs, or identifiers that fail the checked
  low-cardinality format.
- Let the shared Playwright reporter write each job's complete test summary in
  the Playwright step. Do not assemble Markdown across steps because GitHub
  gives every step an isolated `GITHUB_STEP_SUMMARY` file.
- Configure the public PostHog project ingest token and ingest host as
  variables in the `workspace-checkout-e2e` GitHub Actions environment, not
  secrets; management and trace-read API keys remain secrets.
- Propagate Effect's `AbortSignal` through the Playwright runner and close the interrupted case's context so in-flight browser work is cancelled. Do not retry state-creating checkout submission as a whole; a retry can create duplicate orders and leak cleanup state. The reservation-preparation UI action may retry once after its recognized generic error only when it reuses the same `checkoutAttemptId` within the same `checkoutSessionId`; the backend attempt key is the immediate-retry idempotency boundary. Never extend that retry to provider payment creation.
- Treat arrival at the Nexi hosted page as the provider-session creation
  barrier: production creates and links the attempt, awaits provider-session
  attachment, and only then returns the redirect URL. Database visibility can
  still trail that redirect under concurrent load, so converge only the
  retry-safe read for the exact active attempt within the short browser-action
  timeout. Retain a fixed low-cardinality diagnostic for the last observed
  reservation, active-attempt, token, or redirect state. Reject malformed
  provider-session responses at the checked-in OpenAPI contract and never
  retry payment creation after response decoding fails.

Before inspecting production or provider logs, read `../deskohub-workspace-operations/references/diagnostics.md` and apply its redaction and summarization rules.

Update this skill when developer feedback changes the E2E workflow or exposes another durable failure mode.
