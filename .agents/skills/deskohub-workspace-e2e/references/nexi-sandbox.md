# Nexi sandbox

## Environment boundary

- Use the Nexi sandbox origin for local, preview, and automated testing and the live origin only in production. Pair each credential with its environment and terminal type, and keep the API key server-side.
- Get sandbox credentials and test cards from the approved Nexi source or the configured environment. Never commit, print, or copy them into a skill, log, issue, or PR.
- The sandbox merchant may support a different currency from the Workspace catalog. `NEXI_CHECKOUT_CURRENCY_OVERRIDE` changes only the Nexi adapter's session-creation and verification arguments. Quotes and persisted payment facts keep catalog currency, so E2E database assertions expect catalog currency. Reject the override in production or with the live origin.

## Payment contract

- Prefer implicit accounting for hosted checkout. A successful result may report an executed authorization with both authorized and captured amounts; don't require a separate capture. Use explicit accounting only when the app deliberately implements authorize-now, capture-later.
- Create the pay action with a stable local order ID. Result and notification URLs must be public HTTPS endpoints Nexi can reach.
- Treat notifications as triggers. Read the order from Nexi and compare order ID, amount, and currency before you change local payment state. Compare a security token only when Nexi returns one.
- Send the app correlation ID on session creation and order verification so calls can be traced without customer or payment data.
- The hosted UI, 3DS stub, wording, and cancellation controls belong to Nexi. Assert the state before redirect, the verified notification, and the result and status experience after return. Cover a successful payment and an unsuccessful or cancelled return followed by the Workspace retry path.

## Hosted page driver

The sandbox renders each card field in its own iframe and Continue, Pay, 3-D Secure, and Back to the shop in the main document. Drive it from main-document AI snapshots, which include iframe content with frame-scoped refs: locate a field by role and exact accessible name, enter only the iframe that owns it, and restore the main frame in the same scope. Match buttons by role and exact accessible name.

The sandbox fails on its own side. Known signs:

- `POST /fe/build/text/` returns 4xx or 5xx (typically 400 with `GW0027`) after Continue. Nexi treats it as a silent save error: the fields stay disabled and Pay never appears.
- The `/hpp/nexi/error` "Payment error" page.
- "OPS! Something went wrong" after a `validateAndPay` HTTP 500.

Fail fast with the `nexi_hosted_<step>_<state>` diagnostic code instead of waiting out the step timeout. Never reload the rejected page or resubmit card data into it.

## Failed and cancelled payments

The hosted page has no cancel control that Nexi records. The card step offers only Continue, and the Pay step's Back stays on Nexi. Browser Back to the cancel URL leaves the order with no operations, so the Workspace payment stays `pending` until hold cleanup. The cancelled cases therefore inject their terminal state after Nexi opens.

A real failure comes from the 3-D Secure stub. Its "Autenticazione fallita" (`challenge_failure`) choice records an `AUTHORIZATION` with result `THREEDS_FAILED` and ends on the `/hpp/nexi/error` "Payment error" page. That page's Back to the shop goes to the result URL. Accept the error page only after the driver has chosen that failure (`challengeOutcome: "failed"`); before that it is still a sandbox rejection. The `payment-authentication-failed` case returns through the real result URL. The status page then reconciles the order with Nexi to `failed` (`nexi_payment_failed`), with no webhook replay, and the case follows Try again.

For failed `/fe/build/` responses, the failure `network.har` keeps only provider error codes (`errors[].code`), workflow enums (`event`, `state`, `workflowState`), and `fieldStatus` events with known field IDs; everything else is redacted. Read those codes before you blame the sandbox. If one case is rejected repeatedly while other paid cases pass, reproduce its order values (amount, currency override, customer info) directly against the sandbox before rerunning.

## Sandbox restart

`completeHostedCheckoutPayment` in `e2e/cases/checkout.ts` restarts a sandbox-rejected payment once; `e2e/checkout/nexi-sandbox-retry.ts` decides. Only terminal provider pages qualify: `card_submission_rejected`, `provider_error_page`, or `provider_failure_page`. A step timeout, unknown or server-error state, or app assertion never qualifies. The step decides the rest:

- `card_entry` and `continue` come before any authorization request, so they always restart.
- `pay` restarts only if the driver never activated Pay. Once Pay is activated, Nexi may have authorized even if `validateAndPay` returned 5xx, and retiring the local attempt wouldn't cancel that, so the case fails.
- `challenge` and `return` follow authorization and never restart.

The `restart-sandbox-rejected-payment` step:

1. Logs the diagnostic code and the code-only Nexi failure lines.
2. Retires the rejected attempt with `retireRejectedPaymentAttemptForE2E`: marks the attempt and reservation payment state `failed` and releases its discount-code, voucher, and referral invitation claims, keeping the hold so cleanup is unchanged.
3. Closes the hosted tab and waits `nexiSandboxRetryDelayMs`.
4. Reopens the saved checkout pay page URL, whose `payState` value is registered for redaction.

Normal Pay then creates a new attempt and Nexi order, and the `-retry` steps assert both IDs changed. A second rejection fails the case; rerun the exact-SHA workflow.
