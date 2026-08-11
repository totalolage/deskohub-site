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

## Verification

Treat notifications as triggers. Read the order from Nexi and compare the expected order identifier, amount, and currency before changing local payment state. Compare a security token only when Nexi returns one in the notification or operation.

Send the application correlation identifier on session creation and order verification so provider calls can be traced without logging customer or payment data.
