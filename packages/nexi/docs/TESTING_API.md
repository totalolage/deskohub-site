# Nexi XPay CEE Testing API

This document records the Nexi XPay CEE test API values and behaviors used by Deskohub integrations.

## Environment Origin

Use the sandbox origin for all local, development, preview, and automated testing:

```env
NEXI_API_ORIGIN=https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp
```

The live origin is production-only:

```env
NEXI_API_ORIGIN=https://xpay.nexigroup.com/api/phoenix-0.0/psp
```

Do not use the live origin for local development or preview testing.

## API Key Requirements

XPay CEE authenticates API requests with the `X-API-KEY` header. The key is a server-side secret and must never be sent to browser/client code.

Use a dedicated test API key with the sandbox origin. Do not use a production API key against the sandbox, and do not use the published sandbox keys against the live origin.

Nexi publishes these direct API test keys:

| Terminal | API key | Use |
| --- | --- | --- |
| Implicit accounting | `bcf67740-9013-4dd9-bbfb-02debdf7206f` | Default for normal hosted checkout tests where successful payments should be captured automatically. |
| Explicit accounting | `c25f1119-07af-4ad0-b978-b297f62a4320` | Use only when testing separate authorization and later capture/confirmation flows. |

For the Workspace hosted checkout flow, prefer the implicit accounting test key unless the feature explicitly needs an authorize-now/capture-later flow.

Do not use the plugin test key from Nexi examples for direct CEE API calls. It can fail against the Phoenix direct API with `PS0057 Forbidden - headers error` because it is not the same credential type as the direct `X-API-KEY` terminal keys above.

## Implicit vs Explicit Accounting

Accounting controls when an approved payment is confirmed for settlement.

Implicit accounting confirms the approved transaction during the payment phase. In the CEE `GET /orders/{orderId}` response, a successful implicit-accounting HPP payment can still appear as `operationType=AUTHORIZATION` with `operationResult=EXECUTED`, while `authorizedAmount` and `capturedAmount` are both set. Treat `AUTHORIZATION EXECUTED` as a successful terminal payment for this flow; do not require a `CAPTURE EXECUTED` operation.

Explicit accounting authorizes the transaction during payment, but the merchant must later send an explicit confirmation/capture for transactions that should settle. Nexi allows confirmations for previous days, provided they are not later than 4 calendar days. If an approved transaction is not captured, the cardholder's available balance may remain blocked until the authorization expires according to the issuing bank's rules.

Use implicit accounting for simpler checkout testing where payment success should immediately mean paid. Use explicit accounting only when the application implements and tests the extra capture/confirmation step and the operational states for authorized-but-not-captured orders.

## Test Cards

Use Nexi's test cards only in the sandbox environment.

| Scheme | Card number | Expiry | CVV | Expected result |
| --- | --- | --- | --- | --- |
| Visa | `4509 0345 4361 5006` | `10/2028` | `298` | OK |
| Mastercard | `5100 9908 1789 6004` | `04/2027` | `301` | OK |
| Visa | `4349 9401 9999 7007` | `12/2028` | `829` | KO |

The public CEE test merchant and cards are currency-sensitive. The OK cards have been verified with the published implicit direct API key using `EUR`. The same card path can return provider-side `AUTHORIZATION FAILED` with `CZK`, even when request signing and HPP creation are otherwise correct. When debugging a Workspace payment failure in sandbox, first reproduce with `EUR` before treating a `CZK` authorization failure as an application bug.

For 3DS sandbox challenges, choose the successful authentication option in the Nexi stub to complete the OK-card path.

## Hosted Payment Page Request Notes

For the Workspace HPP flow, include `paymentSession.actionType=PAY`. Send a stable local order ID as `order.orderId`; this is the ID returned in webhooks and used for `GET /orders/{orderId}` verification.

`paymentSession.notificationUrl` and `paymentSession.resultUrl` must be public HTTPS URLs reachable by Nexi. Localhost callbacks are not suitable unless they are exposed through a real HTTPS tunnel.

## Order Verification Notes

Treat Nexi server-to-server notifications as triggers only. Confirm the terminal result with `GET /orders/{orderId}` before changing local payment state.

Verification should compare the local expected order ID, amount, and currency against Nexi order facts. Compare the HPP `securityToken` only when Nexi returns it in the notification or order operation; CEE `GET /orders/{orderId}` does not always echo the token on successful payments.

Send `Correlation-Id` on HPP creation and order verification requests so Nexi calls can be traced across application logs and provider support.

## Workspace Local Env Example

```env
NEXI_API_ORIGIN=https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp
NEXI_API_KEY=bcf67740-9013-4dd9-bbfb-02debdf7206f
```

If Workspace preview testing needs to validate the public Nexi sandbox happy path while catalog prices are `CZK`, set `NEXI_CHECKOUT_CURRENCY_OVERRIDE=EUR` only for non-production sandbox deployments. Do not use that override with the live Nexi origin or production Vercel environment.
