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

- Keep deployment protection enabled for previews when required, but configure Vercel's protection-bypass secret in `VERCEL_AUTOMATION_BYPASS_SECRET`.
- Workspace appends `x-vercel-protection-bypass` to Nexi notification/result URLs only for preview deployments when the secret is present.
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
