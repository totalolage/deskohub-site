# Workspace Vercel Preview E2E Checklist

Use this checklist for Workspace preview deployments focused on Nexi payment and notification behavior. Nexi callbacks require a public HTTPS URL, so the payment/webhook happy path should be validated on a Vercel preview or another externally reachable HTTPS deployment. Do not treat Dotypos reservation fulfillment as a preview blocker until the Workspace reservation table ID code placeholder is replaced.

## Static Validation

Run from the repository root after installing dependencies with Bun:

```bash
bun run typecheck:workspace
bun run lint:workspace
bun run typecheck:boardgame
bun run lint:boardgame
git diff --check
```

Run the package-level Nexi check from `packages/nexi`:

```bash
bun run typecheck
```

If database scripts need a schema-only sanity check before a DB exists, run from `apps/deskohub-workspace` after populating `.env.local` or exporting placeholder values for all required typed env vars. `drizzle.config.ts` imports the full typed env, so a syntactically valid `DATABASE_URL` alone is not enough.

```bash
bunx drizzle-kit generate --config drizzle.config.ts --name preview_sanity
```

Remove any generated migration files afterward unless they are intentionally being kept. The repository now includes a fresh Workspace baseline migration generated from the current `db/schema/**` state for the disposable dev database/bootstrap flow. Future schema changes should generate additional migrations normally.

## Required Environment

User-supplied values:

- `DATABASE_URL`: Postgres connection string for the preview/dev database. No database exists yet, so provision one first.
- `NEXI_API_KEY`: Nexi API key for the environment under test.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: required when Vercel deployment protection is enabled and Nexi must call protected preview callback URLs.
- `DOTYPOS_CLIENT_ID`, `DOTYPOS_CLIENT_SECRET`, `DOTYPOS_REFRESH_TOKEN`, `DOTYPOS_CLOUD_ID`, `DOTYPOS_BRANCH_ID`, `DOTYPOS_EMPLOYEE_ID`: Dotypos credentials and IDs.
- `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`: real Workspace email provider settings used by live contact/manual reservation flows.
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`: Cloudinary account and webhook signing values.
- `NEXT_PUBLIC_GTM_ID`: GTM container ID, if enabled for preview.

Known/defaultable values:

- `NEXI_API_ORIGIN`: `https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp` for Nexi sandbox. See [`../../../packages/nexi/docs/TESTING_API.md`](../../../packages/nexi/docs/TESTING_API.md) for test keys, accounting terminal behavior, and test cards.
- `NEXI_CHECKOUT_CURRENCY_OVERRIDE`: optional. Use `EUR` only in non-production deployments against Nexi sandbox when validating the public Nexi CEE test merchant/cards. Leave unset for production and for any test merchant that supports the product catalog currency directly.
- `DOTYPOS_API_URL`: Dotypos API origin for the configured account.
- `DOTYPOS_API_TIMEOUT`: `30000` unless a different timeout is required.
- `VERCEL_ENV`, `VERCEL_URL`, `VERCEL_PROJECT_PRODUCTION_URL`: provided by Vercel on deployments. Local values are deployment stand-ins only because callback config builds `https://${url}`; local Nexi HPP callbacks need a real HTTPS URL reachable by Nexi, or use a Vercel preview deployment.

Vercel protection notes:

- Keep deployment protection enabled for previews when required, but configure Vercel's protection-bypass secret in `VERCEL_AUTOMATION_BYPASS_SECRET`. Use Vercel's auth bypass documentation at `https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation`.
- Read the secret value from `.env.development.local` as `VERCEL_AUTOMATION_BYPASS_SECRET`; do not print or commit the secret.
- For browser/manual testing, start from the protected preview URL with `?x-vercel-protection-bypass=$VERCEL_AUTOMATION_BYPASS_SECRET`, or append `&x-vercel-protection-bypass=$VERCEL_AUTOMATION_BYPASS_SECRET` when the URL already has query parameters. If this sets access for the browser session, use that preview URL for the Nexi checkout return/callback-safe flow.
- For automation, pass either the same query parameter or the `x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` header when fetching/navigating, whichever is more convenient.
- Workspace appends `x-vercel-protection-bypass` to Nexi callback URLs only for preview deployments when the secret is present. Workspace-owned post-callback redirects add `x-vercel-set-bypass-cookie=true` so the final result or retry page can render in the same protected deployment without sending that cookie-setting parameter through Nexi.
- If webhooks appear not to arrive, first confirm the callback URL works through protection with the bypass parameter before debugging Nexi payload handling.

Nexi sandbox notes:

- Use the published CEE implicit-accounting direct API key for the normal hosted checkout happy path.
- The public CEE OK cards have been verified with `EUR`. They can return provider-side `AUTHORIZATION FAILED` with `CZK`, even when HPP creation and callback handling are correct.
- For Workspace catalog prices in `CZK`, use `NEXI_CHECKOUT_CURRENCY_OVERRIDE=EUR` on sandbox preview only when the goal is to validate the app payment/webhook path against the public Nexi test merchant.
- A successful implicit-accounting CEE payment may verify as `operationType=AUTHORIZATION`, `operationResult=EXECUTED`, with both authorized and captured amounts set. This is a successful paid state for Workspace.

Email notes:

- Workspace `email.config.ts` supports `resend`, `smtp`, `sendgrid`, `mailgun`, and `console`.
- Preview should use a real provider, not `console`, when validating notification delivery.
- SMTP-specific variables are only required when `EMAIL_PROVIDER=smtp`: `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD`, and optionally `EMAIL_SMTP_SECURE`.

## Database Bootstrap

The Workspace migrations have been rewritten into a fresh single baseline, `apps/deskohub-workspace/db/migrations/0000_chubby_lucky_pierre.sql`, generated from the current schema.

1. Provision a fresh Postgres database or branch for preview/dev.
2. Set `DATABASE_URL` in Vercel preview environment variables.
3. For this disposable dev database, drop and recreate the schema before applying the rewritten baseline.
4. Apply the baseline migration to the preview/dev database.
5. Do not apply rewritten migration history to non-disposable databases unless they are reset first.
6. Future schema changes should generate additional Drizzle migrations normally from `apps/deskohub-workspace/db/schema/**`.

## Preview Deployment

Do not deploy from this checklist automatically. When ready, use Vercel CLI explicitly:

```bash
vercel env pull .env.local --cwd apps/deskohub-workspace
vercel --cwd apps/deskohub-workspace
```

If the project is not linked yet, run Vercel's link flow from `apps/deskohub-workspace` and confirm it points at the Workspace project before deploying.

## Build-Time Migrations

Workspace Vercel builds intentionally run Drizzle migrations before the app build, but that wiring must stay scoped to the Workspace Vercel project. App-root deployments resolve to `bun turbo build:vercel`, where Turbo's `build:vercel` task depends on the Workspace `db:migrate` task and the real Workspace `build` task. The app's `build` script remains the atomic core Next build (`next build --turbo`), while Turbo's Workspace build task is responsible for running `i18n:compile` and upstream generation such as `@deskohub/nexi#generate` before that build starts.

Workspace runtime variables are listed in the root Turbo `globalPassThroughEnv` so tasks can read the same environment Vercel provides without every secret invalidating cache entries. Individual task `env` lists should contain only variables that affect that task's cache key, such as `DATABASE_URL` for `db:migrate` and public/build-url variables for `build`. The Drizzle config intentionally validates only `DATABASE_URL` for `db:migrate`; the later Next build validates the rest of the Workspace runtime environment.

Do not put Workspace migrations in the shared repository-root `vercel.json`: root-linked Vercel projects for other apps must not advance the Workspace database schema or build the Workspace app. If the Workspace Vercel project remains linked at the repository root instead of `apps/deskohub-workspace`, configure that specific Vercel project's Build Command in Vercel project settings to run `bun turbo build:vercel --filter=deskohub-workspace`.

The selected migration policy is all Vercel builds migrate. This is unconditional for production and preview builds, using that deployment environment's `DATABASE_URL`. This is high risk if preview deployments point at the production database; only do that when accepting that preview builds may advance production schema.

Database requirements and risks:

- `DATABASE_URL` is required in every Vercel environment that builds Workspace.
- Prefer a direct, unpooled Neon Postgres connection URL for migrations. Keep pooled URLs for runtime traffic only when both are configured separately.
- Review and commit generated SQL in `apps/deskohub-workspace/db/migrations` before deploy.
- Migrations can advance the schema even if the later Next.js build or deployment fails.
- Concurrent production and preview builds can race on the same database if they share `DATABASE_URL`.

## Checkout E2E Procedure

Run Nexi checkout E2E against a Vercel preview deployment, not localhost. Nexi HPP result and notification callbacks must be public HTTPS URLs reachable by Nexi, and Workspace builds those URLs from the preview deployment host.

1. Deploy the Vercel preview first.
2. Confirm the preview environment uses the Nexi sandbox origin and sandbox API key from [`../../../packages/nexi/docs/TESTING_API.md`](../../../packages/nexi/docs/TESTING_API.md).
3. If validating Workspace catalog prices that are still `CZK` against the public Nexi CEE sandbox merchant/cards, set `NEXI_CHECKOUT_CURRENCY_OVERRIDE=EUR` on the preview environment only.
4. Open the deployed preview URL and run the customer checkout flow from that URL so the HPP request contains public HTTPS `notificationUrl` and `resultUrl` values.
5. Complete one payment with an OK sandbox card and the successful 3DS stub option.
6. Start a second checkout and exercise the cancellation or failure path with the documented KO card or a user cancellation from HPP.
7. From the returned Workspace status page, retry or restart checkout as the UI allows and confirm the retry path does not mutate the already failed/cancelled order into a false success.

## First E2E Focus

Validate the payment and notification path first:

- Checkout initiation creates a `payment_orders` row with `payment_status=created` or `payment_pending` and stores only safe checkout metadata.
- Browser redirects to the Nexi HPP URL.
- HPP request includes `paymentSession.actionType=PAY`, a public HTTPS `notificationUrl`, and a public HTTPS `resultUrl`.
- For Nexi sandbox OK-card testing, complete the 3DS stub with the successful authentication option.
- Nexi notification webhook records a `webhook_events` row without logging raw payloads or secrets.
- Successful payment is verified through Nexi `GET /orders/{orderId}` before local state changes. The notification payload is a trigger, not the authoritative result.
- Successful payment transitions the order to `payment_status=paid`, sets `paid_at`, and records provider operation/status fields.
- Duplicate or replayed webhook notifications are idempotent and keep stable state.
- Logs do not contain `NEXI_API_KEY`, raw webhook payloads, card data, or customer secrets.

Validate cancellation/failure retry behavior separately:

- A KO sandbox card or cancelled HPP session returns to the preview result/status URL without creating a paid order.
- The order remains `payment_status=payment_failed`, `cancelled`, or another documented non-paid terminal/pending state that matches the provider result.
- Retrying checkout creates or uses the intended follow-up checkout path without overwriting the failed/cancelled provider facts from the original order.
- A later successful retry still follows the same webhook verification and database checks as the normal OK-card path.

Database checks for a successful sandbox payment:

- `payment_orders.payment_status = 'paid'`.
- `payment_orders.last_provider_status = 'EXECUTED'`.
- `payment_orders.last_provider_operation_id` is set when Nexi returned an operation ID.
- `payment_orders.paid_at` is set.
- `payment_orders.checkout_details.payment.expectedPrice.currency` reflects the actual currency sent to Nexi. With the sandbox override enabled, this should be `EUR` even if the product catalog/UI remains `CZK`.
- `webhook_events.status = 'processed'` for the applied event identity.

Expected fulfillment boundary:

- Dotypos reservation fulfillment may fail because `WORKSPACE_DOTYPOS_TABLE_ID` is hardcoded to a placeholder in `apps/deskohub-workspace/features/checkout/backend/constants.ts` and guarded in `dotypos-reservation.adapter.ts`.
- No env var currently configures the Workspace Dotypos table ID.
- This is acceptable for the first preview as long as payment/webhook state is correct.
- Confirm the order remains `payment_status=paid`, transitions to `fulfillment_status=failed`, sets `fulfillment_failed_at`, and records a stable `fulfillment_failure_code`.
- If fulfillment fails before email dispatch, customer/internal emails may not send in the first pass; this should not block payment/webhook validation.

## Post-Deploy Checks

After deploying a preview URL:

```bash
vercel inspect <preview-url>
vercel logs <preview-url>
```

Check Vercel function logs around checkout creation, callback handling, Nexi notification handling, and fulfillment. Inspect the preview database for `payment_orders` and `webhook_events` state transitions, then verify email provider delivery logs if the fulfillment path reaches notification dispatch.

If the return/status page says payment was received but access needs help, inspect fulfillment state before re-debugging Nexi. That page is expected when payment is `paid` but Dotypos reservation/access fulfillment failed.
