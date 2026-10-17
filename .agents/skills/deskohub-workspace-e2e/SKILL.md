---
name: deskohub-workspace-e2e
description: Workspace E2E, Playwright, protected preview, exact-SHA run, checkout or account lane, Nexi sandbox, webhook replay, E2E fixtures, date shard, E2E failure triage, flaky E2E.
---

# Deskohub Workspace E2E

The code is the source of truth for automated runs. Start from these files in `apps/deskohub-workspace/`:

- `scripts/workspace-e2e.ts`: the entry point (`test:e2e`). It launches the checkout and instant-navigation Playwright configs concurrently.
- `playwright.e2e.config.ts`: the checkout and account project graph. Cases live in `e2e/playwright-checkout/`, `e2e/account/`, `e2e/access-codes/`, `e2e/email-campaigns/`, `e2e/administrators/`, and `e2e/cases/`.
- `playwright.instant-navigation.config.ts`: navigation tests in `e2e/instant-navigation/`; only the administration navigation seeds data (one synthetic administrator).
- `e2e/e2e-env.ts`: the only `process.env` boundary for the runner.
- `e2e/timeouts.ts`: every E2E timeout, poll interval, and watchdog.
- `.github/workflows/workspace-e2e.yml`: the CI workflow.

If a reference disagrees with the runner, follow the runner and fix the reference in the same change.

## Read the reference for your task

- Running E2E, CI workflow, preview target, environment variables, preview database, local checks: [preview workflow](references/preview-workflow.md).
- Playwright projects, case pool, account lane, workers, hosted-payment permit, fail-fast cleanup, date shards, coordination database, webhook replay permit, Dotypos capacity, trace contract: [suite orchestration](references/suite-orchestration.md).
- Discount, Calendar, customer, account, email, admin, access-code, or email-campaign fixtures and synthetic data: [fixtures](references/fixtures.md).
- Writing browser steps (hydration, forms, tooltips, streamed pages, assertions): [browser driving](references/browser-driving.md).
- Diagnosing a failed run or a known provider failure: [failure triage](references/failure-triage.md).
- Hosted payment page, sandbox restart, currency override: [Nexi sandbox](references/nexi-sandbox.md).
- Referral cases, seeded sessions, referral cookie, account identity journals, share-link account case: [referral cases](references/referral-lane.md).
- Checkout persistence and lifecycle: [checkout lifecycle](../deskohub-workspace-checkout/references/lifecycle.md).

Before you inspect production or provider logs, read [operations diagnostics](../deskohub-workspace-operations/references/diagnostics.md) and apply its redaction rules.

## Always apply

- Run full E2E only against the protected immutable Vercel Git preview of the exact committed and pushed SHA. Uncommitted code has no preview; never report it as tested through an older deployment.
- Never deploy, alias, or reconfigure Vercel from the runner, and keep Deployment Protection on. Use the automation-bypass flow.
- Exercise the same route and workflow a real request uses. Set up state through approved integrations and fixtures; never add query parameters, runtime branches, or other bypasses to the app for E2E.
- Use synthetic data only. Build every email recipient with `testEmailAddress` from `@deskohub/test-email`; never sign in as or copy a real customer into a preview.
- Keep timeouts in `e2e/timeouts.ts`; the runner accepts no environment overrides. Express each case as named semantic steps, each with a focused timeout, inside a case watchdog.
- Never retry state-creating checkout submission or payment creation. The only payment restart is the classified Nexi sandbox restart.
- Provider request timeouts stay tight in production and are longer elsewhere. Calendar uses 5 seconds in production and 15 seconds elsewhere, with one retry ([Calendar time budgets](../deskohub-workspace-checkout/references/pricing.md#calendar-time-budgets)). Nexi uses 5 and 30 seconds ([Nexi timeouts](../deskohub-workspace-checkout/references/lifecycle.md#timeouts)). Dotypos uses `DOTYPOS_API_TIMEOUT`, 30 seconds by default, in every deployment ([Dotypos request timeouts](../deskohub-dotypos/SKILL.md#request-timeouts)). When you change one, check that every page, action, and E2E deadline wrapping it still fits, such as `getCheckoutSubmitDeadline`.
- Never print preview URLs, connection strings, provider or customer identifiers, magic links, or secrets in logs, traces, annotations, or artifacts.
- Before trusting or asserting on message text, run `bun turbo i18n:compile --filter=deskohub-workspace`. Paraglide output can lag `features/i18n/messages/*.json`.

Update this skill when developer feedback changes the E2E workflow or exposes another durable failure mode.
