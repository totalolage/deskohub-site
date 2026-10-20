# Workspace referrals

Workspace customers can invite new customers through a personal share link or by sharing their referral code. All entry points follow the same eligibility and attribution rules.

The referral program is switched on and off as a whole. While it is off, customers see no referral features, referral codes are treated like unknown codes, and no referral discount is offered and no new referral is accepted. An order that already carries a referral discount from before the program was switched off is honored: its referral is recorded when that order is paid. Referrals recorded earlier are kept and apply again once the program is back on.

## Referral sources

A customer's referral can come from exactly three sources:

- **Profile completion.** When a customer signs in for the first time, the profile-completion form has an optional referral code field. A code entered there becomes the customer's referral when the profile is saved, and the invitation discount then applies automatically to their first booking. The customer doesn't enter the code again at checkout. A typed code that can't be used is reported on the field, so the customer can correct or remove it before saving. A code pre-filled from a share link that stops working before saving is skipped without blocking sign-up. After saving, the account shows whether the referral was applied, and keeps showing that result on every visit until the customer dismisses it. If recording it fails temporarily, it is retried on later account visits. While the customer's first payment is still in progress, the referral waits. Once that payment is paid, it is either applied (or reported as already referred) when the payment carried a referral code itself, or reported as not applied because the first booking is done. A code that would create a referral cycle is reported as not applied. A profile saved in checkout's contact step has no referral field; a remembered or typed code reaches that first booking through checkout instead.
- **Checkout code field.** A referral code entered in the existing checkout code field, which is shared with ordinary discount codes, applies the invitation discount to the current booking when the booked customer is eligible, whether the account books for its own customer or for someone else. The referral is recorded only when that booking is paid, so a failed or abandoned payment leaves the customer without a referral. A rejected code stays in the field with an explanation.
- **Share link.** The share link carries the code in the address. Opening any Workspace page with a referral code in the address makes the browser remember that code for 30 days. A shared link opened later doesn't replace a code that is already remembered. The remembered code is used where it's needed:
  - On a first-time sign-in, the profile-completion referral field is pre-filled with it when the code can be used.
  - When the first sign-in links the account to an existing Workspace customer record, so that profile completion is skipped, the code becomes the customer's referral automatically if they are eligible.
  - When a signed-in customer books for themselves, checkout applies it automatically. When an account books for another person, a usable code is pre-filled in the checkout code field, and the booker applies it like a typed code.
  - A code the customer types in the completion field or checkout code field takes precedence over the remembered one. A referral code typed at checkout and accepted replaces the remembered code, so editing the order keeps it.
  - A remembered code that can't be used is ignored without blocking sign-up or checkout.
  - The browser forgets the code once the booker's own referral is recorded or their own first booking is paid. Booking for someone else never makes the booker's browser forget it.
  - The remembered code stays in the browser that opened the link, so opening the sign-in email on another device doesn't carry it over.

There is no separate step for accepting an invitation.

## Attribution and eligibility

A referral belongs to a Workspace customer. Account sources (profile completion and the share link at sign-in) require a verified customer account linked to that customer. At checkout, the referral belongs to the booked customer: the account's own customer when it books for itself, or the customer found or created from the email typed when booking for someone else. It is set once, between account creation and the customer's first booking, and never changes afterwards. Submitting the same referral again is harmless. Changing referrer, referring yourself, and forming a referral cycle are rejected. At checkout, a different referral code for a customer who already has a referrer is rejected with an explanation. A customer whose profile is already complete can still get a referral, but only through checkout on their first booking. A customer with an earlier paid booking can't get one at all.

An invited customer receives a 15% discount on their first paid Workspace booking. A customer with any earlier locally recorded paid Workspace booking is ineligible, including a booking made before account signup. An older confirmed Dotypos reservation without local payment evidence also excludes that customer. An unpaid checkout hold does not count as an earlier paid booking.

The first-booking benefit can be reserved by only one checkout at a time. Failed, cancelled, or expired payment attempts release it. Successful payment consumes it permanently. Payment retries and late-payment recovery cannot grant it to two bookings or reset an already consumed benefit.

## Referrer discount

The referrer's current discount depends on distinct invited customers who have a qualifying visit in the trailing 30 days. A qualifying visit is a paid Workspace reservation whose end time has passed and whose reservation has not been cancelled. A person contributes at most once; a later qualifying visit refreshes their eligibility.

For `n` eligible people, the remaining price multiplier is `0.95^n`. The discount is `1 - 0.95^n`: 5% for one person, 9.75% for two, and 14.2625% for three. There is no separate program cap. The monetary benefit is rounded once to the currency's smallest unit.

The window ends at the current checkout time and expires each visit's contribution after exactly 30 elapsed days. Eligibility is recalculated at checkout. Local paid status is authoritative for payment eligibility; this program does not query the payment provider for refunds. An externally refunded booking may therefore continue to count until its existing local payment or reservation state reflects disqualification.

## Checkout

Both referral benefits apply to Workspace reservation families under their existing discountable-price rules. They compound with sales, ordinary codes, and customer discounts using the existing pricing rules. Vouchers continue to apply as credit. A customer may receive both referral benefits when eligible for both.

Customer-specific referral discounts appear after customer identity is resolved. A change in referral eligibility after the customer reviews a price requires an updated price to be accepted before payment begins. Completed bookings preserve the accepted labels and monetary discounts.

A referral code entered in checkout goes through the same eligibility checks as every other source, applied to the booked customer. It is recorded only when the booking is paid. It cannot attribute another customer's booking, replace an existing referrer, bypass a previous booking, or apply the invitation benefit twice. Ordinary codes and vouchers remain usable alongside a referral relationship. The checkout code field takes one code at a time: a customer who wants both should enter the referral code first, then the ordinary code.

## Customer account

The account has a referral section showing the customer's share link and code, the current referrer discount, the number of currently eligible invited people out of everyone they have invited, and the amount saved through referrals so far. The discount is shown rounded up to a whole percent; checkout applies the exact value. Savings add up both referral benefits on the customer's own successfully paid bookings, totalled per currency. A refunded payment keeps only the unrefunded share of its referral discounts, and a payment awaiting a full refund counts nothing. While the discount is above zero, the account navigation shows it beside the referral section. The share link carries no language, so it opens in the recipient's language. The section explains the first-booking benefit, the trailing visit window, how the discount compounds, and how few eligible referrals pass a 20% discount. Counts do not disclose other customers' profile details. The section does not accept other customers' codes.

Referral relationships and prior paid-booking evidence use the existing customer identity. Deleting an authentication account does not erase paid history, reset first-booking eligibility, or rewrite accepted discounts. A referral code cannot be used while its owner's account is unavailable or being deleted.

## First-release scope

The invitation benefit is fixed at 15%, and each eligible invited person contributes a compounding 5% reduction. This release has no editable reward settings, manual reward overrides, or automatic invitation emails. Boardgame Bar referrals are outside scope.
