# Nexi sandbox behavior

## Environment boundary

Use the Nexi sandbox origin for local, preview, and automated testing. Use the live origin only in production. Keep the API key server-side and pair a credential only with its intended environment and terminal type.

Obtain current sandbox credentials and payment instruments from the approved Nexi source or the configured test environment. Never commit, print, or copy them into a skill, test log, issue, or pull request.

## Accounting mode

Prefer implicit accounting for the hosted checkout path. A successful implicit-accounting result may be reported as an executed authorization while both authorized and captured amounts are present; do not require a separately named capture operation for that terminal.

Use explicit accounting only when the application intentionally implements the authorize-now, capture-later lifecycle and its recovery states.

## Hosted payment page

Create a pay action with a stable local order identifier. Notification and result addresses must be public HTTPS endpoints reachable by Nexi.

The hosted payment UI, 3DS stub, wording, focus behavior, and cancellation controls are provider-owned. Deskohub assertions cover the state before redirect, the verified notification, and the result/status experience after return.

## Currency boundary

The public sandbox merchant or its test instruments may support a currency different from the Workspace catalog. A non-production sandbox override may change only the Nexi adapter arguments used for session creation and verification.

Customer-visible quotes and locally persisted payment facts retain catalog currency. Reject the override for production or the live Nexi origin.

## Preview E2E

Run the complete payment flow only against the ordinary protected immutable preview for the exact committed SHA. Use the preview's configured sandbox credential and the approved test payment data. Do not describe local uncommitted code as tested through an older hosted deployment.

Cover successful completion and an unsuccessful or cancelled return followed by the Workspace retry/restart path. Follow [preview-workflow.md](preview-workflow.md) for target, protection, database, fixture, and cleanup requirements.

## Hosted page driver

The sandbox page renders each card field in its own iframe and the Continue, Pay, 3-D Secure, and Back to the shop buttons in the main document. Drive it from main-document AI snapshots: they include iframe content with frame-scoped refs, so locate a field by role and exact accessible name, enter only the iframe that owns it, and restore the main frame in the same scope. Match buttons by role and accessible name, never by substring.

The sandbox fails intermittently on its side. Observed failures include `POST /fe/build/text/` returning HTTP 400 after Continue, the `/hpp/nexi/error` "Payment error" page, and "OPS! Something went wrong" after a `validateAndPay` HTTP 500. The 400 case is the most deceptive: Nexi handles it as a silent save error, so the card form stays on screen with its fields disabled and no Pay button ever appears. Fail fast with the `nexi_hosted_<step>_<state>` diagnostic code instead of waiting out the step timeout. Never reload the rejected hosted page or resubmit card data into it.

A checkout case restarts a sandbox-rejected payment once, through a fresh payment attempt (`completeHostedCheckoutPayment` in `e2e/cases/checkout.ts`; the decision lives in `e2e/checkout/nexi-sandbox-retry.ts`). Only terminal provider pages qualify: `card_submission_rejected`, `provider_error_page`, or `provider_failure_page`. A step timeout, an unknown or server-error state, or any app assertion never qualifies. The step decides the rest:

- `card_entry` and `continue` run before any authorization request, so they always restart. This covers a failed `POST /fe/build/text/` card-data save (HTTP 4xx or 5xx, typically 400 `GW0027`), which tends to hit the first real card-data submission of a run.
- `pay` restarts only when the driver never activated Pay. Once Pay is activated, Nexi may have authorized the payment even if `validateAndPay` answers with HTTP 5xx, and retiring the local attempt would not cancel that authorization, so the case fails.
- `challenge` and `return` follow authorization and never restart.

The `restart-sandbox-rejected-payment` step works in this order:

1. Logs the diagnostic code and the code-only Nexi failure lines.
2. Retires the rejected attempt with `retireRejectedPaymentAttemptForE2E`. This marks the attempt and reservation payment state `failed`, releases its reserved discount-code and voucher claims, and keeps the hold, so cleanup is unchanged.
3. Closes the hosted tab and waits `nexiSandboxRetryDelayMs`.
4. Reopens the saved checkout pay page URL. Its `payState` value is registered for redaction.

The app's normal Pay submission then creates a new attempt and a new Nexi order, and the `-retry` steps assert that both identifiers changed. A second rejection fails the case. Rerun the exact-SHA workflow when a restarted payment is rejected again.

Nexi states the reason for a rejected hosted-field call only in that response body. For failed Nexi `/fe/build/` responses, the failure `network.har` keeps only provider error codes (`errors[].code`), workflow enum values (`event`, `state`, `workflowState`), and `fieldStatus` events with known hosted-field ids. Every other field and body is redacted. Read those codes before blaming the sandbox. When the same case is rejected repeatedly while other paid cases in the run succeed, reproduce its order values (amount, currency override, customer info) directly against the sandbox before rerunning.

## Verification

Treat notifications as triggers. Read the order from Nexi and compare the expected order identifier, amount, and currency before changing local payment state. Compare a security token only when Nexi returns one in the notification or operation.

Send the application correlation identifier on session creation and order verification so provider calls can be traced without logging customer or payment data.
