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
- Keep Vercel Deployment Protection enabled. Use its automation-bypass cookie/header/query flow for browser navigation, preview callbacks, readiness checks, and webhook replays. BotID is a separate production-only application concern; read the BotID skill before changing that boundary.
- For dynamically rendered forms, wait for the relevant framework handler to be hydrated before interacting; do not use network idle as the readiness signal because analytics traffic can keep it open. Then use browser-native fill commands and semantic accessibility locators so framework handlers receive trusted interactions. If agent-browser's combined semantic click does not emit a click event, capture a fresh accessibility snapshot after hydration, immediately focus that reference, and activate it with the native keyboard. Do not capture references before hydration or reuse them after intervening DOM changes, and do not replace native form submission with an evaluated DOM click.
- Run independent E2E cases with raw fail-fast Effect concurrency. Do not convert case effects to `Exit` before the parallel aggregate; doing so makes failures look successful to the parent and prevents sibling interruption.
- Own browser sessions in the suite's Scope. Capture diagnostics for the genuine failure before closing sessions, and use bounded finalizers to stop HAR capture and close every failed, completed, or interrupted case.
- Express each case as named semantic steps with a focused timeout (navigation, UI transition, provider transition, or datasource convergence), plus a generous case watchdog. Avoid using a single checkout-wide timeout for every browser command and poll.
- Propagate Effect's `AbortSignal` through command runners into spawned processes so interruption actually cancels in-flight browser work. Do not retry state-creating checkout submission as a whole; a retry can create duplicate orders and leak cleanup state.

Before inspecting production or provider logs, read `../deskohub-workspace-operations/references/diagnostics.md` and apply its redaction and summarization rules.

Update this skill when developer feedback changes the E2E workflow or exposes another durable failure mode.
