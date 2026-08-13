# Workspace discounts

## Discount definitions

Every discount defines one customer benefit:

- a positive percentage reduction or a positive fixed-money reduction;
- a complete customer-facing label in every supported language; and
- one or more eligible product families: cowork, meeting room, or office.

The label shown to a customer is preserved with the completed checkout so later wording changes cannot rewrite history. A missing or blank required translation makes that discount unavailable; labels never fall back from one language to another.

Several sales or codes may share the same benefit definition while keeping their own schedules, audiences, and usage limits.

## Automatic sales

An automatic sale separates its schedule from its benefit. The business calendar owns when the sale is active, while the discount definition owns the customer label, adjustment, and eligible products. The calendar title is for operators and is never used as customer copy.

Sale timing uses Prague calendar time and an exclusive end. Cancelling or removing the scheduled occurrence stops the sale. A malformed occurrence or missing benefit suppresses only that sale; other valid discounts continue to work.

Overlapping valid sales may all participate in pricing. The home-page banner is intentionally narrower: it appears only when exactly one active sale can be advertised unambiguously.

## Discount codes

Codes use uppercase ASCII letters, digits, underscores, and hyphens and contain between 3 and 64 characters. An ordinary discount code owns:

- whether it is enabled;
- an optional inclusive start and exclusive end;
- an optional positive global-use limit; and
- an optional positive per-customer-use limit; and
- an optional customer allowlist.

Omitting either use limit makes that dimension unlimited. Existing codes with a finite global limit retain one use per customer; existing globally unlimited codes remain unlimited per customer. An empty customer allowlist means the code is open to every customer; adding the first customer makes it restricted.

## Vouchers

A voucher is a promotional credit entity, not a discount code and not a product that customers can buy. It owns positive issued credit and has no discount definition. Vouchers and discount codes share only the promotion-code namespace, syntax, enablement, validity window, and optional customer allowlist so one entered value can never resolve ambiguously.

A voucher has no use-count limit or per-customer redemption limit, applies to every product family, and may be reused while matching-currency credit remains. Checkout applies at most the smaller of the remaining credit and the current discountable subtotal and shows the localized generic label “Voucher”.

Available credit is the issued value minus reserved and redeemed applications. Entering a voucher does not reserve credit. Final payment admission locks and rechecks it; a failed, cancelled, or expired payment releases its reservation, while a paid claim permanently consumes the exact applied amount. Concurrent checkouts can therefore never spend more than the issued value.

Disabling a discount code or voucher is preferred to deleting it when historical applications or redemptions exist. Removing every customer from an allowlist makes the promotion unrestricted again, so that change must be deliberate.

Administration exposes discount codes and vouchers as separate resources. Both the Admin UI and `dhw` support creating, inspecting, replacing, disabling, changing validity and audience, and deleting unused vouchers. Issued credit cannot be reduced below reserved and redeemed value, and its currency or exponent cannot change after any credit has been reserved or spent.

## Customer experience

Automatic discounts shown on the reservation page are affirmed again when the order summary is created. Customer-specific discounts may first appear after the customer is identified. A code is applied only after the customer deliberately submits it from the order summary.

Once shown, a discount cannot disappear, change, or be replaced silently. Checkout presents an updated summary for acceptance before payment begins. A code error does not prevent the customer from paying the prior valid summary without that code.

A bounded discount may show a localized expiry countdown near the end of its active period. Automatic sales use a 24-hour countdown window; bounded codes use a one-hour window. The presentation depends on the declared expiry, not on how the discount was sourced.

## Usage evidence

Accepted discounts are snapshotted with their resolved label and applied amount. Ordinary-code capacity and voucher credit both include reserved and redeemed claims; a released claim consumes neither but remains part of operational history.

Application and redemption evidence is immutable. Corrections require a reviewed repair process and must never be achieved by editing completed customer history in place.
