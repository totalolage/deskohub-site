---
name: deskohub-workspace-e2e
description: Run, debug, or modify Deskohub Workspace E2E and integration tests, especially protected exact-SHA previews, checkout, Nexi payment, webhooks, preview databases, Dotypos state, or localized-copy validation flows.
---

# Deskohub Workspace E2E

## Establish the workflow

Treat [the Workspace E2E entry point](../../../apps/deskohub-workspace/scripts/workspace-e2e.ts), [orchestrator](../../../apps/deskohub-workspace/e2e/workspace-e2e.ts), and nearby `e2e/**` cases and services as the executable source of truth for automated runs. Inspect the relevant case and service before running or changing the suite.

Read only the supporting documentation needed for the scenario:

- Preview environment, deployment protection, callbacks, and state checks: [Workspace Vercel preview E2E](../../../apps/deskohub-workspace/docs/WORKSPACE_VERCEL_PREVIEW_E2E.md).
- Current checkout persistence and lifecycle: [checkout lifecycle](../../../apps/deskohub-workspace/docs/checkout-lifecycle.md).
- Nexi sandbox behavior and test inputs: [Nexi testing API](../../../packages/nexi/docs/TESTING_API.md).

Distinguish automated-runner behavior from manual procedures before treating a difference as stale. If documentation conflicts with the runner about an automated run, follow the runner and update the stale documentation in the same change.

## Preserve E2E invariants

- Before trusting generated copy or changing assertions based on message text, run `bun turbo i18n:compile --filter=deskohub-workspace` from the repository root. Paraglide output can be stale relative to `features/i18n/messages/*.json`.
- Treat email-provider secrets that exist only in Vercel as intentionally unavailable to local E2E. Validate delivery through Vercel runtime or webhook evidence, and validate email body content with the fake transport renderer.
- Run full E2E only against the ordinary protected Vercel Git preview for the exact committed and pushed SHA. Use the immutable deployment URL from `vercel.deployment.success` or an explicitly supplied workflow-dispatch input; never scrape the PR comment or substitute a mutable branch/custom-domain alias.
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
- Remember that repository-dispatch workflow configuration is evaluated from the default branch even when the job checks out an exact PR SHA. Do not make exact-SHA validation depend on changing a workflow-level environment value in the same PR; keep canonical expectations in the checked-out runner code or supply them through an already-compatible dispatch contract.
- Do not add runtime branches, query parameters, or other production behavior that bypasses the normal application path for E2E. Establish the required fixture state through approved integrations, then exercise the same route and workflow a real request uses.
- Keep Vercel Deployment Protection enabled. Use its automation-bypass cookie/header/query flow for browser navigation, preview callbacks, readiness checks, and webhook replays. BotID is a separate production-only application concern; read the BotID skill before changing that boundary.
- Disable Next.js prefetch on every cross-locale switch link. The Workspace proxy persists the locale cookie for localized requests, so prefetching the alternate locale can race the customer's actual navigation and restore the previous locale. Keep this invariant shared across full, mobile, and minimal headers rather than fixing one presentation in isolation.
- For dynamically rendered forms, wait for the relevant framework handler to be hydrated before interacting; do not use network idle as the readiness signal because analytics traffic can keep it open. Then use browser-native fill commands and semantic accessibility locators so framework handlers receive trusted interactions. Select the actual control by accessibility role rather than a wrapping `LabelText`, and parse its snapshot reference independently of attribute order because state such as `checked` may precede `ref`. Prefer a stable app-owned id or form-scoped selector for critical activation when one exists: parallel browser sessions can invalidate an accessibility reference between snapshot capture and activation. Focus that stable selector and activate it with the native keyboard because agent-browser's combined `click` can return successfully without emitting a form submission. When no stable selector exists, capture a fresh accessibility snapshot after hydration, immediately focus that reference, and activate it with the native keyboard. Do not capture references before hydration or reuse them after intervening DOM changes, and do not replace native form submission or link navigation with an evaluated DOM click.
- Run independent E2E cases with raw fail-fast Effect concurrency. Do not convert case effects to `Exit` before the parallel aggregate; doing so makes failures look successful to the parent and prevents sibling interruption.
- Own browser sessions in the suite's Scope. Capture diagnostics for the genuine failure before closing sessions, and use bounded finalizers to stop HAR capture and close every failed, completed, or interrupted case.
- Express each case as named semantic steps with a focused timeout (navigation, UI transition, provider transition, or datasource convergence), plus a generous case watchdog. Avoid using a single checkout-wide timeout for every browser command and poll.
- Preserve the E2E OTLP trace contract when changing orchestration. Emit one
  root run span, one child span for every case, and one child span for every
  semantic step. Use fixed low-cardinality span names, native span duration,
  the configured timeout as a numeric attribute, closed outcome/failure-kind
  values, and the same shared censoring boundary as normal Workspace logs. Keep
  the execution context a closed `manual | ci` value, use only code-owned
  case/step IDs and safe GitHub correlation metadata, and never attach preview
  URLs, provider or database identifiers, customer/order/reservation data, raw
  errors, secrets, or artifact contents.
- Configure the public PostHog project ingest token and ingest host as
  variables in the `workspace-checkout-e2e` GitHub Actions environment, not
  secrets; management and trace-read API keys remain secrets.
- Propagate Effect's `AbortSignal` through command runners into spawned processes so interruption actually cancels in-flight browser work. Do not retry state-creating checkout submission as a whole; a retry can create duplicate orders and leak cleanup state. The reservation-preparation UI action may retry once after its recognized generic error only when it reuses the same `checkoutAttemptId` within the same `checkoutSessionId`; the backend attempt key is the immediate-retry idempotency boundary. Never extend that retry to provider payment creation.

Before inspecting production or provider logs, read `../deskohub-workspace-operations/references/diagnostics.md` and apply its redaction and summarization rules.

Update this skill when developer feedback changes the E2E workflow or exposes another durable failure mode.
