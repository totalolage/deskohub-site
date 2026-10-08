# Workspace referrals

Workspace customers can invite new customers through a personal share link or by sharing their referral code. The same code can be entered in the existing checkout code field. Both entry points follow the same eligibility and attribution rules.

## Attribution and eligibility

Accepting a referral requires a verified customer account linked to a Workspace customer. The invited customer keeps one permanent referrer. Accepting the same referral again is harmless; changing referrer, referring yourself, and forming a referral cycle are rejected.

An invited customer receives a 15% discount on their first paid Workspace booking. A customer with any earlier locally recorded paid Workspace booking is ineligible, including a booking made before account signup. An older confirmed Dotypos reservation without local payment evidence also excludes that customer. An unpaid checkout hold does not count as an earlier paid booking.

The first-booking benefit can be reserved by only one checkout at a time. Failed, cancelled, or expired payment attempts release it. Successful payment consumes it permanently. Payment retries and late-payment recovery cannot grant it to two bookings or reset an already consumed benefit.

## Referrer discount

The referrer's current discount depends on distinct invited customers who have a qualifying visit in the trailing 30 days. A qualifying visit is a paid Workspace reservation whose end time has passed and whose reservation has not been cancelled. A person contributes at most once; a later qualifying visit refreshes their eligibility.

For `n` eligible people, the remaining price multiplier is `0.95^n`. The discount is `1 - 0.95^n`: 5% for one person, 9.75% for two, and 14.2625% for three. There is no separate program cap. The monetary benefit is rounded once to the currency's smallest unit.

The window ends at the current checkout time and expires each visit's contribution after exactly 30 elapsed days. Eligibility is recalculated at checkout. Local paid status is authoritative for payment eligibility; this program does not query the payment provider for refunds. An externally refunded booking may therefore continue to count until its existing local payment or reservation state reflects disqualification.

## Checkout

Both referral benefits apply to Workspace reservation families under their existing discountable-price rules. They compound with sales, ordinary codes, and customer discounts using the existing pricing rules. Vouchers continue to apply as credit. A customer may receive both referral benefits when eligible for both.

Customer-specific referral discounts appear after customer identity is resolved. A change in referral eligibility after the customer reviews a price requires an updated price to be accepted before payment begins. Completed bookings preserve the accepted labels and monetary discounts.

Entering a referral code in checkout requires the same verified account and eligibility checks as accepting its share link. It cannot attribute another customer's booking, replace an existing referrer, bypass a previous booking, or apply the invitation benefit twice. Ordinary codes and vouchers remain usable alongside a referral relationship.

## Customer account

The account has a referral section showing the customer's share link and code, the current referrer discount, and the number of currently eligible invited people. It explains the first-booking 15% benefit and the trailing 30-day rule. Counts do not disclose other customers' profile details.

Referral relationships and prior paid-booking evidence use the existing customer identity. Deleting an authentication account does not erase paid history, reset first-booking eligibility, or rewrite accepted discounts. A share code cannot be accepted while its owner's account is unavailable or being deleted.

## First-release scope

The invitation benefit is fixed at 15%, and each eligible invited person contributes a compounding 5% reduction. This release has no editable reward settings, manual reward overrides, or automatic invitation emails. Boardgame Bar referrals are outside scope.
