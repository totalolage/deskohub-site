# Calendar sales and discount definitions

The [discount specification](../../../../apps/deskohub-workspace/docs/discount-codes.md) defines customer-facing sale policy. A Calendar sale is a Google Calendar occurrence that references a discount definition stored in Postgres. The code lives in `features/discounts`.

## Ownership

- Calendar owns occurrence timing. The trimmed event description must be exactly one discount UUID. Reject rich-text wrappers, prose, and any extra content.
- The event title is operator metadata. Never show it to customers.
- Postgres owns the definition: the locale-indexed label map, the adjustment, and the product targets. The label map is the only label source. Don't add a scalar or fallback label.
- A product target names a reservation family or one saleable cowork tier. Match products only through `workspaceProductTargetMatches`, and lock claim targets through `getWorkspaceProductTargetsCovering`, both in `features/discounts/product-target.ts`. The legacy `discount_product_targets` sync triggers widened every cowork target to the whole family; migration `20261014063616_drop_legacy_discount_target_sync` dropped them, and they stay dropped.
- Require a trimmed, non-empty label for every application locale, and reject missing or unsupported locale keys. Never fall back across languages.
- Fixed discounts pick a currency from `shared/money/currencies.ts` and take the stored unit from `unitOf`. Never accept a separately entered exponent. A currency outside the catalog, such as one carried over from an existing record, has no unit, so the admin form sends no mutation and shows its check-the-form error.
- Snapshot the resolved label in checkout and application history, so later translation edits can't rewrite what a customer saw.

## Eligibility

A sale applies only when the booking instant is inside the occurrence's Prague all-day booking window (exclusive end) and the reservation's last service date is on or before the sale's last day. Earlier service dates qualify. A range that extends past the last day gets no sale and is never prorated.

- Express this only through `calendarSaleAppliesToBooking` and `isCalendarSaleBookableAt` in `features/discounts/calendar-sale.ts`.
- `lastServiceDate` is the office `endsOn`, the cowork `date`, or, for a meeting room, the Prague date of its exclusive `endsAt`, because hourly bookings can cross midnight.
- `expiresAt` is the end of the booking window. The countdown and the home-page banner both target it.

Load [the checkout skill's pricing reference](../../deskohub-workspace-checkout/references/pricing.md#booking-instant) for where the booking instant comes from, the anonymous advertisement boundary, discount affirmation, and `pricing_changed`.

## Resolution failures

- Log a malformed event or a missing, malformed, or unavailable definition at Error level and omit only that sale. Keep every other resolved discount.
- A whole Calendar failure yields no Calendar candidates and doesn't block initial discovery.
- Mark a partial resolution incomplete (`complete: false`). Never cache it as a complete success.

## Caching

- `loadCalendarDiscountSource` (`features/discounts/calendar-discount-source.server.ts`) shares only complete occurrence and definition snapshots across requests through `use cache: remote`, keyed by the booking's Prague date, through `readSharedSnapshot`. Partial or failed loads expire at once (`expire: 0`), so the next request retries them.
- Don't put a process-memory cache in front of the remote cache. It hides invalidation and can't share entries across Vercel instances.
- Keep the source cache locale-independent. Run feature-flag evaluation, booking-time eligibility, locale and product filtering, label resolution, checkout revalidation, and advertised-price token sealing outside it.
- Definition mutations call `refreshCalendarDiscountSourceAfterMutation` (`features/discounts/admin/calendar-discount-source-maintenance.server.ts`), which expires the cache tag and primes it best-effort. Calendar edits rely on time-based revalidation, because Workspace doesn't own that mutation.

## Home-page banner

`features/landing-page/landing-page-sale-banner.server.ts` shows the banner only when exactly one sale is active. With overlapping sales, it logs the count and omits the banner. Pricing still resolves and stacks overlapping sales independently.
