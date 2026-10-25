# Checkout pricing

Customer-facing price policy lives in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md) and the [discount specification](../../../../apps/deskohub-workspace/docs/discount-codes.md). Calendar sale eligibility belongs to the domain skill's [sales calendar reference](../../deskohub-workspace-domain/references/sales-calendar.md). This file covers how the code enforces them.

## Price boundaries

Checkout has three price boundaries. Each one affirms what the previous one showed:

1. **Advertisement.** The reservation page shows a price and issues an integrity-protected advertisement snapshot.
2. **Signed summary.** Reservation submission opens the snapshot, builds the authoritative quote, and signs the order summary into the Pay state.
3. **Payment.** Order submission freshly affirms the signed summary before any payment attempt exists.

Any change to price facts accepted at the previous boundary returns `pricing_changed` with the affected product keys (for example `product:cowork:basic`) and a refreshed signed summary. `pricing_changed` is a normal workflow result, not a failure.

### Advertisement

- Evaluate only anonymously discoverable pricing: Calendar sales and, when the URL supplies `discountCode`, the public part of an ordinary code. Exclude vouchers.
- Never resolve or create a Dotypos customer to advertise a price. The snapshot holds no PII and no customer-pricing marker.
- Put only amount-determining inputs in advertised-price requests, snapshots, quote items, fingerprints, and query keys. Cowork monitor selection, reservation purpose, and billing details stay out. Keep them in reservation validation, availability, table assignment, and the signed reservation state.
- If anonymous discovery fails before render, log it and advertise without that discount.

### Reservation submission

- Affirm only the anonymous discounts that were advertised. Never add one that became available after the snapshot.
- After Dotypos identity resolution, fully validate a query code and evaluate the customer discount. A query code that fails validation yields a summary without it. The customer discount may appear for the first time here without `pricing_changed`. This exception applies to nothing else.
- Once a discount appears in a signed summary, it follows the normal affirmation and `pricing_changed` rules everywhere.

### Discount-code entry

The summary page's code form is an independent action (`features/checkout/actions/apply-discount-code.ts`). It never resubmits the reservation or the order.

1. Affirm every displayed discount. A change returns `pricing_changed`.
2. An invalid or unavailable code returns a field error and leaves the current summary payable.
3. A valid code returns a new signed summary. It creates no payment attempt, persists no application, and reserves no capacity.

Keep `submittedCode` and `changedKeys` in the common signed Pay-state envelope. Every reservation family quotes and affirms through its own canonical product identity; dispatch family-owned quote, summary, persistence, and checkout-details projections exhaustively, with no implicit cowork default.

### Payment

The accepted payment amount must equal the last signed summary total exactly. Order submission affirms exactly the signed discounts and compares the full quote fingerprint and total. A mismatch, or a failure to persist applications or admit a claim, returns `pricing_changed`, rolls back, and never calls Nexi.

- Positive total: create a Nexi attempt and HPP session.
- Zero total: in one transaction insert an already-paid `internal` attempt, mark the reservation paid, persist application snapshots, and redeem any admitted claim. Never call Nexi.

Persist discount applications and admit code or voucher claims in the payment-attempt creation transaction. Redeem in the paid transaction; release in every failed, cancelled, or expired transaction. Any application or claim error is fatal to its owning transition. Never convert it to an empty discount result or `not_pending`. Voucher admission locks the voucher row and rechecks the exact available amount in that transaction.

## Unknown discounts

A displayed or advertised discount is **gone** only when every provider resolved completely and none returned it. `PromotionCodeUnavailableError` and a disabled release gate are complete answers.

When a provider fails or resolves incompletely (Calendar `complete: false`) and a displayed discount is unmatched, the discount is **unknown**. `selectAffirmedCandidates` in `features/discounts/discount.service.ts` fails with `DiscountAffirmationUnavailableError`:

- Reservation submission, order submission, and the post-identity query-code check surface it as a retryable `PublicSafeActionError`. The customer retries the unchanged summary.
- Discount-code entry treats it as an unavailable code and leaves the summary payable.
- Never answer it with `pricing_changed`, a re-signed summary, or a payment attempt.
- Never fall back to an earlier Calendar read. Affirmation (`CalendarDiscountProvider.revalidate`) always reads Google Calendar directly. Only advertisement discovery uses the shared cache.

Provider failures that leave every displayed discount matched don't block affirmation.

## Booking instant

A Calendar sale applies according to the booking instant. The eligibility rule itself is in the domain skill's [sales calendar reference](../../deskohub-workspace-domain/references/sales-calendar.md); this section covers only where the booking instant comes from.

- Advertisement and the home-page banner use the current instant.
- Reservation submission (`prepareWorkspacePayState`) captures the instant once and signs it into the Pay state as `bookedAt`. Re-signed Pay states carry it forward.
- Every later affirmation reads `getSignedPayStateBookedAt`, never the clock: summary acceptance, code entry, payment start, and claim-conflict refresh.
- Editing the reservation creates a new Pay state and a new booking instant. Never use the reservation draft's creation time.
- Webhook, finalization, and late-payment recovery read persisted application snapshots and never re-evaluate eligibility.

Meeting-room advertised-price details carry `lastServiceDate` rather than clock times, so the advertisement stays keyed by dates.

## Calendar time budgets

Each Calendar request attempt times out after 5 seconds in production and 15 seconds elsewhere (`getGoogleCalendarRequestTimeout`, built on `getDeploymentRequestTimeout`). `listEvents` retries a transient failure once and bounds the whole load, all pages included, by `getGoogleCalendarRequestWorstCaseDuration`.

An action that awaits Calendar in sequence with other work adds one worst-case load per sequential Calendar load to its deadline:

| Action | Deadline getter | Calendar loads |
| --- | --- | --- |
| Reservation submission | `getPreparePayStateDeadline` | 2 (sales affirmation, then availability limitations) |
| Discount-code entry | `getApplyDiscountCodeDeadline` | 1, through `getCalendarActionDeadline` |
| Pay submit | `getCheckoutSubmitDeadline` | 1, plus one Dotypos and one Nexi request |

Count a Calendar load that runs in parallel with other work unless that work is reliably slower. The added budget covers one Calendar retry, not every provider being slow at once; that case ends in the retryable timeout error.

When you change a deadline, make the action select it through its getter and make its behavioral test use the same getter. Run the action on a test clock with a Calendar load that succeeds on retry; don't test deadline arithmetic.

## Quotes and summaries

- A quote holds priced items, payment totals, generic discount applications, and the fingerprint. It never embeds a summary or duplicates the reservation selection.
- The checkout summary is a family-owned projection of the signed reservation plus its quote. Zero-priced composition, such as the selected cowork monitor, belongs there.
- Pass canonical reservation projections into pricing. Use the reservation domain's PII-free details projection instead of intersecting fields such as `date` onto an incomplete product type.

## Currency

Keep the catalog currency through advertisement, signed summary, affirmation, and local payment attempts. Apply the non-production Nexi sandbox currency override only at Nexi call sites: HPP creation and verification arguments. It never changes customer-visible quotes or persisted payment facts and is unavailable in production.

## Money

Every Workspace amount is a `Money` from `apps/deskohub-workspace/shared/money/money.ts`: a scaled integer `value`, its decimal `exponent`, and an ISO `currency`. Build, combine, convert, and display amounts through that module instead of restating its rules:

- Check that amounts share a currency and exponent with `sameMoneyUnit`, and total them with `sumMoney`, which fails with `MoneyUnitMismatch`. Keep a separate currency or exponent check only where the caller reports which one differs.
- Convert exactly with `moneyToBigDecimal` and `moneyFromBigDecimal`, which fails with `MoneyPrecisionError` rather than rounding. Write plain decimal text with every minor digit, such as `125.50`, with `moneyToDecimalString`. Use `moneyMajorAmount` only where a JavaScript number is required, such as `Intl` or an external contract.
- Display amounts with `formatMoney(money, locale)` in customer pages, emails, and the administration alike.
