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

## Implicit vs Explicit Accounting

Accounting controls when an approved payment is confirmed for settlement.

Implicit accounting confirms the approved transaction during the payment phase. A successful hosted checkout is authorized and captured automatically.

Explicit accounting authorizes the transaction during payment, but the merchant must later send an explicit confirmation/capture for transactions that should settle. Nexi allows confirmations for previous days, provided they are not later than 4 calendar days. If an approved transaction is not captured, the cardholder's available balance may remain blocked until the authorization expires according to the issuing bank's rules.

Use implicit accounting for simpler checkout testing where payment success should immediately mean paid. Use explicit accounting only when the application implements and tests the extra capture/confirmation step and the operational states for authorized-but-not-captured orders.

## Test Cards

Use Nexi's test cards only in the sandbox environment.

| Scheme | Card number | Expiry | CVV | Expected result |
| --- | --- | --- | --- | --- |
| Visa | `4509 0345 4361 5006` | `10/2028` | `298` | OK |
| Mastercard | `5100 9908 1789 6004` | `04/2027` | `301` | OK |
| Visa | `4349 9401 9999 7007` | `12/2028` | `829` | KO |

## Workspace Local Env Example

```env
NEXI_API_ORIGIN=https://xpaysandbox.nexigroup.com/api/phoenix-0.0/psp
NEXI_API_KEY=bcf67740-9013-4dd9-bbfb-02debdf7206f
```
