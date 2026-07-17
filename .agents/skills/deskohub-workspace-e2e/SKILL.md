---
name: deskohub-workspace-e2e
description: Run, debug, or modify Deskohub Workspace E2E and integration tests, especially checkout, Nexi payment, Resend email, webhook, fresh Vercel preview, alias, database/Dotypos state, or localized-copy validation flows.
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
- For an automated run, let the checked-in runner deploy the fresh preview, assign and verify `new.workspace.deskohub.cz`, open cases on its selected preview URL, and use the alias as the callback origin. For a manual current-code webhook run, deploy a fresh preview from the current working tree, assign the alias to it, and run the checkout through the alias. Use the already-live alias without redeploying only when the user explicitly requests that target.
- Keep `--archive=tgz` on manual and automated Vercel E2E deploys so the current working tree is uploaded as one archive. Do not add `--force`.
- Stop if the alias cannot be verified against the fresh deployment; do not silently run against its previous target.
- For dynamically rendered forms, wait for the relevant framework handler to be hydrated before interacting; do not use network idle as the readiness signal because analytics traffic can keep it open. Then use browser-native fill commands and semantic accessibility locators so framework handlers receive trusted interactions. If agent-browser's combined semantic click does not emit a click event, capture a fresh accessibility snapshot after hydration, immediately focus that reference, and activate it with the native keyboard. Do not capture references before hydration or reuse them after intervening DOM changes, and do not replace native form submission with an evaluated DOM click.
- Run independent E2E cases with raw fail-fast Effect concurrency. Do not convert case effects to `Exit` before the parallel aggregate; doing so makes failures look successful to the parent and prevents sibling interruption.
- Own browser sessions in the suite's Scope. Capture diagnostics for the genuine failure before closing sessions, and use bounded finalizers to stop HAR capture and close every failed, completed, or interrupted case.
- Express each case as named semantic steps with a focused timeout (navigation, UI transition, provider transition, or datasource convergence), plus a generous case watchdog. Avoid using a single checkout-wide timeout for every browser command and poll.
- Propagate Effect's `AbortSignal` through command runners into spawned processes so interruption actually cancels in-flight browser work. Do not retry state-creating checkout submission as a whole; a retry can create duplicate orders and leak cleanup state.

For BotID-protected paths or automation rejection, read `../deskohub-workspace-botid/SKILL.md` before changing the test or protection boundary.

Before inspecting production or provider logs, read `../deskohub-workspace-operations/references/diagnostics.md` and apply its redaction and summarization rules.

Update this skill when developer feedback changes the E2E workflow or exposes another durable failure mode.
