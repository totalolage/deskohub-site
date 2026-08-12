# Deskohub Mobile Shop specification

Status: Implementation and launch specification 1.1 — product decisions complete; release candidate implemented
Last updated: 2026-08-11
Owners: Product, Workspace, Finance/Operations

## 1. Summary

Build one Expo application delivered as an installable Progressive Web App and a directly downloadable Android APK. It lets an eligible Deskohub customer record selected self-service food or drinks, pay in the app, and receive a clear payment confirmation. Both clients use authenticated HTTP APIs in the existing Workspace deployment. Physical collection happens outside the app and may occur before or after the digital purchase flow.

This is a standalone Desktechub mobile shop. It has no catalog, configuration, stock, seller, payment, or operational relationship with Boardgame Bar. The existing Boardgame Bar menu is only a repository example showing that the shared Dotypos integration can read and project products.

The system-of-record split is:

| Concern | System of record |
| --- | --- |
| Customer identity, verification, and sessions | Neon Auth |
| Account-to-customer association | Deskohub `customer_account_links` |
| Reservation facts and commerce customer identity | Dotypos |
| Purchasable catalog and current list price | Dotypos |
| Purchase, accepted final-price snapshot, and recovery state | Deskohub database |
| External payment state | Nexi, verified server-to-server |
| Seller, accepted purchase record, and receipt-email workflow | Desktechub s.r.o. / Deskohub database |
| Warehouse quantity | Dotypos Warehouse after successful payment |

The app is an untrusted presentation client. Dotypos and Nexi credentials remain server-side. The server rechecks reservation entitlement, catalog availability, prices, payment outcome, and Dotypos stock synchronization.

The MVP is intentionally narrow: Neon Auth email-link authentication, a tagged self-service catalog, cart and quantities, Nexi hosted payment, payment status/history, and eventual Dotypos warehouse deduction. No purchase is created or paid through the Dotypos POS. Barcode scanning, stored cards, loyalty, delivery, staff-prepared food, and customer-initiated refunds are later phases.

### Implementation status

The repository now contains the customer-account foundation, mobile-shop schemas and additive migrations, generated Dotypos warehouse operations, authenticated API, reservation-day entitlement, exact catalog/quote rules, Nexi payment/webhook/reconciliation lifecycle, paid-only email receipt, exactly-once stock attempt, PostHog lifecycle events, Expo PWA/Android client, offline catalog/cart behavior, native PKCE session handoff, signed update machinery, and exact-SHA preview/production workflows.

The remaining launch work is external configuration and production validation, not an unresolved product decision: permanent Android and Expo update keys, protected GitHub environment values, the dedicated Vercel project/domain, Neon trusted redirects, Android direct-distribution registration, provider acceptance tests, legal approval, and a physical-device pilot. The exact checklist is maintained in [MOBILE_SHOP_RELEASE.md](./MOBILE_SHOP_RELEASE.md).

## 2. Confirmed decisions

This table is the settled internal decision log. Implementation details not represented here are governed by the normative sections below and do not require more product questioning.

| ID | Decision | Final contract | Why it matters |
| --- | --- | --- | --- |
| D1 | Legal seller | **Confirmed: Desktechub s.r.o.** Its Nexi merchant and accounting workflow own the sale | Dotypos supplies catalog and warehouse facts only; it does not own payment or the customer-facing purchase record. |
| D2 | Eligible reservations | **Confirmed: every supported reservation type grants access.** Accept any live Dotypos `CONFIRMED` reservation belonging to the customer, including cowork and meeting-room reservations | Entitlement must not depend on reservation family, cowork tier, meeting-room duration, or whether the reservation has a matching local family-specific row. Unpaid `NEW` holds and `CANCELLED` reservations never qualify. |
| D3 | Meeting rooms | **Confirmed: meeting-room reservations qualify on the same basis as cowork reservations** | There is no separate shop-access policy by reservation family. |
| D4 | Access window | **Confirmed: a qualifying reservation unlocks shopping for its whole Workspace-local calendar day, `[00:00, next 00:00)`, even when the reservation covers only part of that day.** The session may persist, but commerce is locked outside an eligible day | The boundary uses `workspaceSiteConstants.location.timeZone` and consecutive local midnights, so 23- and 25-hour daylight-saving days remain correct. |
| D5 | Login timing | **Confirmed: every verified Neon Auth account may sign in by email link at any time.** Reservation eligibility gates commerce, never identity or session creation; a user without access today sees a locked shop | Customers can install, authenticate, manage their account, and view accessible history independently of reservation timing without permitting purchases early. |
| D6 | Physical collection versus payment | **Confirmed: the app is order-agnostic.** It neither enforces nor instructs whether the customer physically takes an item before or after recording and paying for it | There is no technical enforcement mechanism, so the app models only item selection, payment, and stock bookkeeping. |
| D7 | Catalog inclusion | **Confirmed: only products explicitly tagged `self-service`;** also require a visible, non-deleted category/product and a valid positive price | Explicit opt-in prevents unrelated Dotypos products from appearing accidentally. |
| D8 | Alcohol | **Confirmed: Desktechub does not offer alcoholic drinks through this app.** Exclude them from every release, including when a product is tagged incorrectly | Alcohol and age-verification flows are not part of the product roadmap. |
| D9 | Price, discounts, and tax regime | **Confirmed: charge the current final Dotypos selling price in CZK, with no discount codes or customer-specific discounts in the first release. Model Desktechub as a non-VAT payer today while supporting a future switch to VAT-payer pricing without a schema redesign** | Tax facts are a versioned, immutable order snapshot. The current regime does not require or display VAT fields; a future VAT-payer regime can require and itemize them. Dotypos field names never determine the legal regime by themselves. |
| D10 | Dotypos write-back | **Confirmed: stock only.** After verified app payment, decrement the configured Dotypos warehouse through its warehouse-sale API; never create or pay a POS order | Payment and the purchase ledger remain wholly in the app/Nexi flow. |
| D11 | Dotypos stock role and outage | **Confirmed: stock is informative and backend-visible only.** A verified payment remains successful when synchronization is delayed or fails; the backend records, retries, and surfaces the issue to staff only | Stock never gates the catalog, checkout, payment result, or customer purchase record. Ambiguous stock API outcomes must not be blindly retried. |
| D12 | Payments | **Confirmed: pay in the app through Nexi Hosted Payment Page; no Dotypos payment and no saved cards in MVP** | The provider adapter, verification, webhook, and recovery patterns already exist. |
| D13 | Receipt | **Confirmed: automatically email a simple Desktechub receipt only after the server has verified the payment as paid.** Never send it when items enter the cart, a quote/order is created, or payment is merely pending. The first release has no PDF, attachment, downloadable document, invoice generator, or document-generation pipeline | Receipt delivery is idempotent post-payment fulfillment using ordinary localized HTML/plain-text email plus the in-app purchase record. It uses the tax regime captured by the paid order and remains independent of Dotypos stock synchronization. |
| D14 | Platforms and distribution | **Confirmed: support an installable PWA and an Android APK downloaded from Deskohub’s website. Do not build or test an iPhone app and do not distribute through Google Play or Apple’s App Store** | Expo Router provides the shared Android/web route tree. The APK needs stable signing and website-based install/update handling; the PWA needs a manifest, service worker, and secure web-session boundary. |
| D15 | Offline behavior | **Confirmed: users may browse the last successful catalog and edit their cart offline, but payment requires connectivity and a fresh server quote.** The catalog is expected to change rarely, so retain the last valid snapshot for offline display rather than expiring it after a day | Cached data is a convenience, never chargeable authority. The UI clearly shows offline/last-updated state, and reconnection revalidates before checkout. |
| D16 | Devices | **Confirmed: the same account may remain signed in on multiple devices or browsers, and may make multiple purchases per day.** Neon Auth owns every independently revocable session; there is no device cap in MVP | Reservation entitlement and ownership are checked per request/order, so a device limit would add friction without becoming a meaningful security boundary. |
| D17 | Duplicate emails and links | **Confirmed: an ambiguous or missing account-to-Dotypos link must never select or union customer records.** Neon Auth still permits the verified account to sign in, but the shop and Dotypos-owned purchase history remain locked until support corrects `customer_account_links`; raise a safe staff alert without exposing the submitted email | This should not occur, but confusing account authentication with commerce identity could expose another customer's reservation or purchase history. |
| D18 | Images | **Confirmed: use a valid Dotypos product image when available and a bundled branded placeholder otherwise.** A missing, malformed, blocked, or failed image never hides or disables an otherwise valid product | Keeps catalog ownership in Dotypos without making photography a prerequisite for sale, and remains usable during image-host outages or offline browsing. |
| D19 | Client updates | **Confirmed: make PWA and compatible Android updates automatic and background-first, and include a native self-updater in the initial APK. Small EAS updates may use any connection; full replacement APKs download only on unmetered Wi-Fi** | The app obtains and verifies the file itself, so the user never has to locate or download an APK manually and mobile data is protected. Android may still require a one-time source permission or system installation confirmation on customer-owned devices. |
| D20 | Languages and translations | **Confirmed: launch in Czech and English and reuse Deskohub's Paraglide and `@deskohub/i18n` infrastructure.** Follow Workspace's `en-US` base-locale fallback; otherwise honor a persisted explicit choice, then the device/browser preference | The native and PWA clients share message keys and product-translation behavior without introducing another i18n library or importing Next.js-only locale routing. |
| D21 | Purchase history | **Confirmed: provide a Purchase history section whenever the verified account has one valid customer link, including outside eligible reservation days.** Reservation entitlement gates new shopping and payment attempts, not access to that linked Dotypos customer's records | Customers can verify past payments, receipt delivery, and support references without needing another reservation. Link and ownership remain enforced server-side and backend stock state is never exposed. |
| D22 | Reservation-email discovery | **Confirmed: every supported reservation-confirmation email includes a localized public “Open the self-service shop” link.** It is an ordinary canonical HTTPS App Link, not an authentication secret | Customers can discover/install the app before visiting. The installed Android app opens when available and the PWA is the universal fallback; the customer still completes normal Neon Auth email-link authentication. |
| D23 | Cross-device login code | **Confirmed: do not provide a manually entered numeric login code in MVP.** A customer requests a new Neon Auth email link on the device/browser they want to use; numeric cross-device transfer remains a possible future expansion | Avoids a second credential type, brute-force controls, extra recovery states, and confusing dormant UI before real demand is established. |
| D24 | Staff support ownership | **Confirmed: existing Workspace administrators own failed-payment, receipt-delivery, refund-reconciliation, and Dotypos stock-sync support through Workspace administration.** Do not create a separate mobile-shop staff role in MVP | Reuses the established staff authentication boundary and keeps sensitive recovery actions out of the customer app. Every manual action remains guarded and auditable. |
| D25 | Analytics | **Confirmed: reuse the Workspace PostHog project, consent model, event-safety rules, and server lifecycle integration on PWA and Android.** Client analytics and session replay remain disabled until analytics consent; do not identify customers with email or Dotypos customer ID | Keeps reporting consistent with the web application without making analytics a commerce dependency or weakening the no-PII boundary. Expo uses the official React Native client behind the same app-owned analytics capability. |
| D26 | Cart quantity limits | **Confirmed: allow at most 10 units of one product and 30 total units in one cart/order.** Enforce both limits authoritatively on the server and proactively in the client | Prevents accidental oversized purchases without pretending to represent stock. The limits reset for each order and do not restrict how many separate purchases a customer may make during an eligible day. |
| D27 | Barcode/EAN scanning | **Confirmed: keep barcode scanning as a documented post-MVP expansion.** Do not request camera permission, ship a scanning dependency, or expose unused EAN data in the first-release client contract | Search and categories are sufficient for launch. Deferring scanning avoids camera/privacy work and ambiguous Dotypos barcode data while preserving a clear versioned path to add it later. |
| D28 | Public app name | **Confirmed: use “Deskohub Workspace” as the full public name and “DW” as the compact text form.** Use the full name in the PWA manifest, Android app label where practical, website, emails, receipts, legal/support copy, and first-run UI; reserve `DW` for constrained text labels | Gives the shop a stable customer-facing identity without exposing implementation names such as `deskohub-mobile`. The seller remains Desktechub s.r.o.; the icon uses the existing Deskohub mark rather than a new DW lettermark. |
| D29 | Brand assets | **Confirmed: reuse the existing Deskohub Workspace assets and visual tokens; do not create a new identity for the shop.** Source logos, icon mark, Sculpin typography, colors, and light/dark variants from the Workspace app, producing only the platform-required Android/PWA exports | Keeps the new clients visually consistent and avoids maintaining copied, drifting brand definitions. Generated raster/adaptive icons remain derived artifacts of the repository-owned SVGs. |
| D30 | Android application ID | **Confirmed: `cz.deskohub.workspace`.** Treat it as permanent across every signed release, App Link association, update manifest, and installer verification | Android upgrades require the same application ID and signing identity. Changing it would install a separate app and break the self-update path. |
| D31 | PWA and App Link origin | **Confirmed: `https://app.workspace.deskohub.cz`.** It is the canonical PWA origin, Android App Link host, magic-link landing origin, payment-return origin, and same-origin mobile API facade | A dedicated HTTPS origin isolates the PWA/service worker from the existing `workspace.deskohub.cz` site while avoiding CORS and third-party-cookie dependencies. |
| D32 | Customer support contact | **Confirmed: `workspace@deskohub.cz`.** Use it consistently for customer-visible shop, payment, receipt, privacy/legal, purchase-history, and APK-install/update support | Reuses the established Workspace channel while backend recovery remains owned by authenticated Workspace administrators. |
| D33 | Identity authority | **Confirmed architecture: Neon Auth is the sole customer identity, verification, magic-link, and session authority; `customer_account_links` is the sole account-to-Dotypos association.** Do not create parallel mobile auth/session tables or infer a customer from email during ordinary app requests | Keeps account lifecycle independent from Dotypos commerce identity while preserving one fail-closed mapping for entitlement, ownership, and history. |

## 3. Goals, non-goals, and success criteria

### Goals

1. Let a customer complete an honest purchase in less than a minute after login.
2. Permit purchases only for the Dotypos customer who has an eligible reservation on the current Prague date.
3. Use Dotypos for the catalog and ultimately reflect paid sales in Dotypos.
4. Prevent duplicate charges and duplicate Dotypos stock deductions during retries, returns, webhooks, or app restarts.
5. Preserve the Workspace no-plaintext-PII posture outside the identity boundary: Neon Auth owns account PII and credentials; commerce tables store Dotypos IDs, immutable purchase facts, and safe references rather than copying customer email/name/phone.
6. Reuse existing server integrations and domain logic while providing a mobile-first interface shared by the PWA and Android, with native Android integration only where it adds value.

### Non-goals for MVP

- Booking or editing reservations in the app.
- Delivery, table service, kitchen tickets, tips, split bills, or open tabs.
- Alcohol and age verification; staff-prepared menu items or product customizations.
- Stored payment cards, subscriptions, wallet balances, credit, or pay-later flows.
- Manual numeric or QR cross-device authentication transfer.
- Loyalty points, Workspace discount codes, or Dotypos customer discounts.
- Live stock quantities. The current Dotypos product contract has `stockDeduct` but no stock-on-hand value.
- In-app refund initiation, invoice editing, or accounting exports.
- PDF receipts, attachments, downloadable invoices, or a general document-generation system.
- A guarantee of silent Android native-binary replacement on unmanaged customer devices.
- Full offline purchasing.
- Barcode/EAN scanning and camera access.
- Tracking, enforcing, or asking the customer to attest when they physically collect an item.

### Explicit post-MVP barcode expansion

- Audit representative Dotypos EAN data for normalization, uniqueness, packaging variants, and missing/duplicate values before designing the feature.
- Add EANs through a versioned catalog/lookup contract only when the scanner is implemented; do not expose an unused barcode list in the MVP catalog DTO.
- A successful scan resolves an authoritative current product, shows a confirmation, and then uses the ordinary cart limit and quote flow. It never creates an order, starts payment, or claims stock automatically.
- Request camera permission only when the user invokes scanning, retain search/category fallback, and support permission denial without degrading the rest of the shop.

### Technical launch criteria

- No client-authored price, reservation ID, customer ID, or payment result is trusted.
- A payment retry cannot create a second live Nexi session for the same purchase attempt.
- A Dotypos synchronization retry cannot deduct the same paid order twice.
- 100% of orders shown as paid have a server-verified paid result.
- At least 99% of paid orders synchronize to Dotypos within five minutes during the pilot; the remainder is visible to staff and retryable.
- Catalog API p95 is under two seconds when Dotypos is healthy.
- No email address, raw Neon Auth credential or magic-link token, payment token, raw provider payload, or stock-operation payload appears in application logs.
- Critical auth, eligibility, price-change, payment-return, webhook, and stock-recovery paths have automated coverage.
- PWA and Android updates are integrity-verified, staged before production, rollback-capable, and structurally unable to interrupt an active payment flow.

Product conversion and shrinkage targets should be set after a staff pilot establishes a baseline.

### Hard prerequisite gate

These are launch dependencies, not unresolved product choices:

- **Completed in this implementation:** the customer-account work is integrated with Neon Auth as the sole identity/session authority and `customer_account_links` as the account-to-Dotypos mapping. The Dotypos contract includes paginated warehouse products and warehouse sale, and the generated client, one-warehouse rule, stock attempt, and ambiguity behavior have automated coverage.
- **Before checkout pilot:** approve Desktechub's localized seller, non-VAT receipt, purchase terms, privacy/retention, refund/support, and sideload wording; confirm the Nexi merchant and target Dotypos warehouse.
- **Before PR APK distribution:** prove a short-lived deployment-scoped Vercel Shareable Link through the native Android HTTP/auth/return flow, or provision the dedicated synthetic-data mobile preview origin. The project-wide automation bypass secret is never a client credential.
- **Before the first public APK:** provision and back up the permanent Android signing identity, register `cz.deskohub.workspace` and its certificate through Android Developer Console for direct distribution, provision the Expo project and signed EAS Update channels, and complete `app.workspace.deskohub.cz` DNS/TLS, same-origin API rewrites, App Links, CSP, and release-manifest ownership.

Failure of any gate blocks its dependent phase or release; it does not reopen the confirmed product decisions in §2.

## 4. Repository baseline and reuse assessment

### Existing reusable capabilities

- `@deskohub/dotypos` provides generated schemas/client calls plus customer and reservation operations.
- Boardgame Bar demonstrates category/product loading, visibility filtering, and localized menu projection in `apps/deskohub-boardgame-bar/features/menu`. It is reference code only: the mobile shop will call the shared `@deskohub/dotypos` client through its own server service and will not import the Bar menu module or reuse its categories, configuration, cache, or operational workflow.
- `@deskohub/nexi` creates hosted payment sessions and verifies results against expected order, amount, currency, and security token.
- Neon Auth provides the customer email-link identity and session boundary. The integrated account implementation supplies `customer_account_links`, account deletion behavior, and the verified mobile handoff.
- `@deskohub/email` and Workspace email configuration can deliver the paid-order receipt after the logging issue below is corrected.
- `@deskohub/i18n/translatable` resolves full-locale, base-language, and default product text.
- Workspace's consent-gated `posthog-js` provider, URL/property sanitizer, server-side `PostHogEventService`, and `@deskohub/posthog` package establish the analytics boundary to reuse. The Expo client needs a small platform adapter over the official React Native SDK; it must not import DOM/cookie components on Android.
- Workspace uses exact integer money values, signed price-state boundaries, idempotent payment attempts, verified webhook transitions, and Prague `Temporal` helpers.
- `defineWorkspaceRoute` is the correct independently addressable HTTP boundary for mobile requests.

### Code that cannot be reused directly

The existing menu and checkout TSX render DOM elements, Tailwind DOM classes, Radix primitives, Next navigation, and Server Actions. They cannot be imported into Expo directly. Build new screens from React Native primitives and Expo Router so the same implementation runs on Android and web; reuse data contracts, state models, copy, tokens, assets, and behavior rather than the existing web component source.

### Gaps and prerequisites discovered

1. The generated Dotypos contract now includes `POST /v2/clouds/:cloudId/warehouses/:warehouseId/sales`, whose items contain a product ID, quantity, and optional note. It is the stock-only boundary and does not create a POS order or POS payment. Because the public response has no idempotency key, a lost response is stored as ambiguous and is never blindly retried. See [Dotypos Warehouse API](https://docs.api.dotypos.com/entity/warehouse/).
2. Authoritative Dotypos catalog and warehouse reads now follow every provider page rather than stopping at 100 records.
3. Boardgame Bar category IDs, presentation metadata, and inclusion rules are deliberately out of scope. The mobile catalog's only inclusion marker is the Dotypos product tag `self-service`, followed by its own safety and validity checks.
4. The mobile API needs its own coherent cache and invalidation contract for product and category changes; it will not depend on the Boardgame Bar cache or webhooks.
5. The customer-account implementation is included in the same release candidate so mobile APIs extend its Neon Auth and `customer_account_links` boundary rather than creating a parallel identity system.
6. `payment_attempts.workspace_reservation_id` is required, and reservation checkout fulfillment confirms a reservation. A shop purchase must not be represented as a fake reservation.
7. `docs/checkout-lifecycle.md` says Workspace access codes must not be stored, while the current `workspace_reservations` schema still stores `customer_access_code`. Mobile auth must not depend on that field, and the inconsistency should be resolved separately.
8. The shared email service currently annotates full message bodies. Receipt content embedded in `text` or `html` would not be reliably censored. Stop logging bodies or add a logging-safe receipt-delivery boundary before sending receipts.
9. Account linking, relinking, ambiguity detection, and account deletion must follow the merged `customer_account_links` contract. Ordinary mobile authentication must never repeat a Dotypos email lookup or create a second implicit mapping.

## 5. Users and entitlement

### Primary user

A verified Neon Auth account may use account-level app surfaces at any time. Commerce requires exactly one valid `customer_account_links` row to a Dotypos customer who owns a live `CONFIRMED` reservation of any supported type on the current Workspace-local day. Physical presence is the intended use context but is not technically attested or enforced.

### Entitlement rule

For each protected catalog read and every quote/order/payment write:

1. Validate the Neon Auth session and derive its verified account subject.
2. Resolve exactly one active `customer_account_links` association to a stable Dotypos customer ID. A missing, revoked, or ambiguous association returns a locked commerce state and never guesses from email.
3. Construct the current Prague calendar interval using `Temporal`: local midnight to the next local midnight. Do not model a day as 24 elapsed hours.
4. Load customer reservations whose intervals can overlap the date.
5. Accept any live `CONFIRMED` reservation where `start < dayEnd && end > dayStart`. Any overlap unlocks the entire local calendar interval, not merely the reservation's start/end hours. Do not filter by reservation family, cowork tier, meeting-room duration, assigned table, or the presence of a family-specific local row.
6. Reject if none remains eligible. A cancellation therefore revokes commerce immediately even if a session remains logged in.

The existing active-overlap query is not reusable unchanged because it includes `NEW` holds. Add a customer-aware, `CONFIRMED`-only operation to the generated/provider boundary.

### Session behavior

- Neon Auth authentication may persist across days, but it is not entitlement.
- Signing in on one device does not revoke existing sessions on other devices. Neon Auth owns session creation, expiry, refresh, and revocation for every Android installation and PWA browser profile.
- There is no device-registration table, trusted-device concept, device fingerprint, or per-account device limit in MVP. A customer may also complete multiple independently idempotent purchases during one eligible day.
- Outside an eligible day, the app shows the signed-in account a neutral locked screen and a link to book Workspace.
- Every verified account may authenticate regardless of reservation history. A qualifying future reservation does not unlock shopping early; the signed-in app shows the locked state until an eligible reservation day begins.
- A payment session created while entitlement is valid may complete after the day boundary. Reconciliation must finish that already-created attempt, but no new attempt may start after entitlement expires.
- Purchase history is owned by the linked Dotypos customer and remains visible outside an eligible reservation day while that sole valid link exists. It includes resumable pending attempts and completed/unsuccessful orders needed for recovery or support; it never unlocks a new quote or payment. A missing or ambiguous link exposes no Dotypos-owned history.
- Account deletion revokes/removes the Neon Auth identity and its account link but never deletes, reassigns, or cascades into purchase, payment, receipt, refund-reconciliation, or stock ledgers. Those records retain their Dotypos-customer ownership for the legally required retention period and remain available only after a later valid account link or through audited staff operations.

### Reservation-confirmation discovery

- Add the same localized self-service-shop call to action to confirmation emails for every reservation family; do not make it conditional on cowork tier or meeting-room duration.
- Link to the canonical HTTPS app origin without a customer ID, reservation ID, email, magic token, or tracking identifier in the URL. Android App Links open the installed APK; every other client lands in the PWA.
- The landing screen may explain that access activates for the whole reservation day and offer installation/sign-in. It must not imply that following the public link grants access.
- Keep the email change independently deployable and disable its call to action until the production PWA/domain and customer-support path are ready.

## 6. Authentication and account-link specification

### Neon Auth boundary

1. The app starts Neon Auth's email-link flow with the selected locale and a canonical HTTPS return on `app.workspace.deskohub.cz`.
2. Neon Auth alone creates, sends, validates, consumes, refreshes, expires, and revokes identity credentials and sessions. Workspace never mints a parallel magic token, bearer token, cookie session, refresh token, or passwordless request record.
3. Every verified Neon Auth account may complete authentication. Reservation existence and Dotypos linkage are not identity-provider admission rules.
4. On Android, the verified HTTPS link opens the installed APK when available and otherwise the PWA. Link-scanner and mail-provider behavior must be proven against Neon Auth's supported flow before pilot.
5. The Android client stores only the Neon Auth mobile session material through the provider-supported SecureStore adapter. The PWA uses Neon Auth's secure web-session integration; app JavaScript never invents or copies a second bearer credential.
6. Every protected Workspace API validates the Neon Auth session, derives the account subject server-side, and then resolves `customer_account_links`. Clients never submit an account ID, Dotypos customer ID, or reservation ID as authority.
7. Logout, account-wide revocation, session expiry, refresh, multiple-device behavior, and email verification follow Neon Auth. The application does not define a second TTL or session lifecycle.

### Account-to-Dotypos link boundary

- `customer_account_links` is the sole mapping between a Neon Auth account subject and a Dotypos customer. A verified account has at most one active customer link, and a Dotypos customer has at most one active account link unless the merged account-domain contract explicitly models a guarded transfer.
- Ordinary requests resolve the persisted link; they never search Dotypos by the current account email or silently repair a link.
- A missing, revoked, duplicate, or otherwise ambiguous link produces an account-level `commerce_identity_unavailable` state. Authentication and account settings continue to work, but catalog, quote, order, payment, and Dotypos-owned history access stay locked.
- Emit a deduplicated staff incident with safe internal account/link/Dotypos IDs and a correlation ID. Never include the email address or expose which source record caused the conflict to the customer.
- Link creation, correction, transfer, and removal use the audited flows established by the customer-account branch. The mobile app offers support, not a customer-selectable Dotypos-record picker.

### Security policy

- Do not log Neon Auth request/response bodies, email addresses, magic-link URLs, credentials, or session material.
- Keep client and API responses generic for identity and link failures; internal codes may distinguish invalid auth from missing/ambiguous commerce identity without exposing account existence publicly.
- MVP has no numeric code, QR transfer, or “enter code from another device” flow. The Check email screen explains that the Neon Auth link should be opened on the intended device and allows another provider-supported request there.
- Bearer/cookie failures return the same public unauthorized response. PWA mutations additionally enforce the expected origin/fetch metadata and the CSRF mechanism required by the selected Neon Auth web integration.
- The Android bundle and public PWA assets contain only public auth project, API, and link configuration, never Neon Auth administrative credentials or provider secrets.

## 7. Catalog specification

### Source and filtering

The catalog service loads all pages of Dotypos categories and products and returns a narrow mobile DTO. An item is purchasable only when all conditions hold:

- Category has an ID, is not deleted, is not explicitly hidden, and is not tagged `non-menu`.
- Product has an ID, belongs to the category, has `display === true`, is not deleted, and carries the exact Dotypos tag `self-service`.
- Product has a parseable, finite, positive resolved final selling price and satisfies the configured CZK currency policy. The active initial regime requires no VAT rate; a future VAT-payer regime will require its separately validated tax facts.
- Product is not classified as alcohol or included in another configured deny policy, such as staff-prepared food. Alcohol exclusion takes precedence over an accidental `self-service` tag.

`showUncategorized` is not appropriate for a purchasable catalog. Inclusion is explicit.

### Mobile catalog DTO

Each response contains:

- Catalog version/hash and generated timestamp.
- Categories: ID, localized name, stable order, optional color.
- Products: ID, category ID, localized display name/description, canonical Dotypos name for snapshots, sanitized image URL, unit/packaging label, exact integer final price, exponent, currency, and product version. EANs are deliberately omitted until the post-MVP scanning contract exists.

Never send raw Dotypos objects or fields the app does not use.

### Tax-regime and Dotypos price mapping

Model the seller tax regime as a versioned discriminated value rather than nullable VAT fields:

- `{ kind: "not-vat-payer", version, effectiveFrom }` — active initially. Quotes, UI, orders, and receipts contain one final CZK price and no VAT rate, net amount, or tax amount.
- `{ kind: "vat-payer", version, effectiveFrom, vatId }` — supported by the domain and persistence design but not active initially. Quotes and receipts require an exact per-line VAT rate, net amount, tax amount, and final amount.

The regime and its version participate in the quote fingerprint and are freshly affirmed before creating payment. A regime change during checkout returns `catalog_changed` for customer review. Each accepted order stores the complete immutable regime snapshot, so later registration as a VAT payer cannot reinterpret historical purchases.

Dotypos exposes nullable `priceWithVat`, required `priceWithoutVat`, and `vat` through VAT-oriented provider terminology. The official Dotypos manual says non-VAT-payer mode presents one final price, while product import represents a non-VAT payer with a 0% VAT setting; do not assume that determines the live API field shape.

Before implementing the catalog projection, verify representative `self-service` products from the configured non-production Desktechub cloud to establish which Dotypos field carries the final price shown in Remote Management under the active regime. Encode that once in the server-side provider adapter as `finalPrice`; do not expose the source field name. Under the initial non-VAT-payer regime, never calculate, add, subtract, or display VAT. Under a future VAT-payer regime, enable the separately tested mapping and validation before activating the new regime. If live fields conflict with the active mapping, exclude the product as a catalog-configuration error rather than guessing.

### Localization and order

- Supported locales are `cs-CZ` and `en-US`; `en-US` is the base fallback, matching Workspace.
- Build the mobile app's UI catalogs with the repository's existing Paraglide compile workflow and message conventions. Reuse platform-neutral `@deskohub/i18n` helpers; do not import the current apps' Next.js middleware, pathname routing, or generated app-specific message modules into Expo.
- On first use, select the best supported match from the Android device locale or browser preferences; use `en-US` when neither language matches. A Settings choice overrides detection and persists through app updates and session changes in AsyncStorage on Android or app-owned browser storage on the PWA.
- Changing language updates the running UI without reinstalling or signing in again. Stable route and App Link URLs are locale-neutral so magic-link and payment returns do not depend on the current language.
- Resolve Dotypos category/product text with `@deskohub/i18n/translatable`: full locale → base language → canonical Dotypos text. A missing translation never hides an otherwise valid item.
- Send the selected locale through Neon Auth's supported email-link localization boundary and with the quote/payment request. Map it to the provider's supported Nexi language code only inside the Nexi adapter.
- Capture the selected locale on the accepted order. It determines the immutable item display-name snapshots and the paid receipt language, so changing Settings later cannot change a retry of that receipt.
- APIs return stable language-neutral error codes and structured facts; the client translates them rather than persisting translated server error text.
- Category and item order should use Dotypos ordering when valid, with product/category ID as deterministic fallback.

### Cache and availability

- Server cache: a 15-minute stale-while-revalidate window with ETag/version responses and explicit product/category invalidation. The window matches the operational expectation that the menu changes rarely; payment never trusts it blindly.
- Client app cache: persist the last successfully decoded catalog snapshot, its schema/catalog version, and `lastValidatedAt` without a short time-based display expiry. Replace it on successful revalidation and discard it only when incompatible with the running client schema or explicitly cleared.
- Revalidate with ETag on online launch/foreground when the last validation is older than 15 minutes, on manual refresh, and immediately before quote/payment. A `304` updates validation time without rewriting the snapshot.
- Android stores the safe catalog snapshot through the platform storage adapter; the PWA stores it in app-owned browser storage rather than the service-worker HTTP cache. Auth, order, and payment responses are never persisted there.
- When offline, show a prominent banner and the last successful update time, allow local search/category browsing and cart edits, and disable Pay with a reconnect explanation.
- Quote/payment always loads or freshly affirms current server-side products; cached client or server display data is never chargeable authority.
- A missing item or changed price produces `catalog_changed` and returns a refreshed review, not a charge.
- Dotypos currently supplies no stock-on-hand field. The app must not claim “in stock”; operations controls availability by product visibility/tag and physical fridge stocking.
- Treat product images as optional presentation data. The server exposes only validated HTTPS image URLs; Android and PWA replace absent or failed images with the same bundled, versioned Deskohub placeholder without changing product availability.
- Cache remote images only through Expo Image's safe public-asset cache. The placeholder is part of the app shell so product cards remain visually stable offline; image requests never carry authentication data.
- Product cards announce the localized product name rather than redundant image-description text to assistive technology.

## 8. PWA and Android product experience

Public product naming is **Deskohub Workspace**, shortened to **DW** only on genuinely constrained surfaces. “Deskohub mobile,” repository package names, and provider names are never customer-facing substitutes. Naming the app does not change the disclosed legal seller, Desktechub s.r.o.

### Brand asset sources

- Use `apps/deskohub-workspace/assets/logo/small-bg:light.svg` and `small-bg:dark.svg` as the canonical compact mark, with the existing plain/color/fancy/cutout variants only where their current contrast and layout purpose fits. `public/favicon.svg` remains the browser-favicon source.
- Derive Android adaptive foreground/background, monochrome/notification, launcher, splash, and required PWA raster sizes reproducibly from those SVG sources. Do not hand-edit generated PNGs or introduce a DW lettermark.
- Extract the existing Workspace palette into a shared platform-neutral token package: navy `#00024f`, silver `#d8d8d8`, sunset yellow `#eca423`, Chilean fire `#f57c00`, burned orange `#dd480a` with ink `#7a2e0a`, and aquamarine `#00df99` with ink `#004c3b`. Semantic app tokens must meet WCAG AA rather than using a brand color blindly.
- Reuse Sculpin: the existing WOFF2 files on web and the repository's native-compatible regular TTF on Android. Validate font licensing, glyph coverage, loading, and fallback before release; do not bundle the unused Asgard, AsgardFit, Hiruko, or Report families solely because they exist.
- Keep one source-of-truth asset/token package consumed by Workspace web and the new Expo app. Build checks regenerate/compare derived icon outputs so PWA and APK branding cannot drift from the source SVGs.

### Screen map

1. **Launch/session restore** — restore the provider-managed Neon Auth session through the Android SecureStore or PWA web adapter and load entitlement.
2. **Sign in** — Neon Auth email field, locale-aware explanation, generic success state.
3. **Check email** — Neon Auth resend countdown, change-email action, link-opening guidance.
4. **Shop locked** — signed-in but either not eligible today or lacking one valid account-to-Dotypos link; present the applicable safe explanation, booking/support action, and no private provider payloads.
5. **Shop** — reservation-day banner, search, category chips, product cards, quantity/cart affordance.
6. **Product detail** — image, name, description, unit, final price, quantity.
7. **Cart** — editable quantities, total, remove, terms/merchant disclosure, “Pay” action.
8. **Catalog changed** — highlight removed or repriced lines and require explicit review.
9. **Hosted payment** — open the Nexi HPP in an authenticated browser session.
10. **Verifying** — poll authenticated order status; never infer success from the return URL.
11. **Paid** — prominent “Payment confirmed” state and order summary, with no instruction about physical collection timing.
12. **Pending/failed/cancelled** — safe recovery, resume, or retry actions based on server state.
13. **Purchase history/detail** — newest-first paginated orders with time, items, total, payment status, receipt-delivery status, support reference, and a `workspace@deskohub.cz` contact action. It remains accessible from the locked state; stock-sync state is deliberately absent.
14. **Settings** — language, `workspace@deskohub.cz` support, privacy/terms, logout, and Android app version or PWA build version.

### Core UX rules

- Cart is local and contains only product IDs/quantities; server response replaces all presentation/price facts at quote time.
- Quantity must be `1..10` per product and the sum of all line quantities must be at most `30`. Duplicate product lines are normalized before validation so they cannot bypass the per-product limit.
- The shared client disables increment/add actions at the applicable limit and explains it locally, but the server independently rejects an oversized cart. These are per-order safety limits, not availability claims or per-day/customer quotas.
- Disable Pay after the first submission and reuse its idempotency key across immediate retries.
- Preserve the cart after network/payment cancellation; clear it only when a paid order is verified or the user explicitly clears it.
- If the app restarts during payment, the order ID is recoverable from local non-secret storage and `/orders/:id` resumes status.
- The success screen shows only the verified payment result and customer-facing order facts. It does not expose Dotypos synchronization or make a claim about when the customer physically collected the items.
- Touch targets are at least 44×44 points, Android font scaling and browser zoom/reflow are supported, keyboard focus is complete on web, all controls have screen-reader labels, contrast meets WCAG AA, and motion respects reduced-motion settings.

## 9. Pricing, orders, and payment lifecycle

### Price boundaries

1. **Catalog display**: informative current server catalog.
2. **Cart review quote**: authoritative item/final-price lines, seller tax-regime snapshot, and total returned by the server with a fingerprint and five-minute expiry. Tax details are absent in the active non-VAT regime and required in the future VAT-payer branch.
3. **Payment creation**: server freshly affirms the same catalog facts immediately before persisting a payment attempt and calling Nexi.

Any item, version, final price, tax-regime version, applicable tax fact, or total change at boundary 3 returns `catalog_changed`; no new Nexi attempt is created. Use exact decimal parsing and scaled integer money, never floating-point `Number` arithmetic.

### Order creation

- Each Pay press uses a client-generated UUID `checkoutAttemptId`.
- The server binds its stored idempotency key to session/customer plus normalized product IDs and quantities.
- Before quoting or creating an order, the server enforces at most 10 units per normalized product and 30 total units. A violation creates neither an order nor a Nexi attempt.
- Same key and same normalized cart returns the existing order/session.
- Same key with different cart conflicts.
- The accepted order snapshot, including seller tax regime and any applicable per-line tax facts, is immutable.
- A positive total creates a Nexi attempt. Zero/negative/unpriced products are not purchasable, so internal zero-total completion is out of MVP scope.

### Nexi flow

1. Create a durable purchase order, immutable items, and a local `created` payment attempt atomically.
2. Call `@deskohub/nexi` with exact order ID, amount, CZK, locale, HTTPS result/cancel URLs, notification URL, and non-logged customer info only if the merchant contract requires it.
3. Attach the hosted-page URL and security token; transition attempt/order to pending.
4. Android opens the HPP using Expo WebBrowser; the PWA uses a full-page browser redirect. Nexi returns to one HTTPS Workspace route, which verifies/reconciles and redirects to the canonical PWA/App Link order route.
5. Webhook and return handling both verify the provider order server-to-server. Neither the deep link nor webhook body is authoritative alone.
6. Mark attempt and order terminal in one transaction. Duplicate matching results are no-ops.
7. A paid transition independently enqueues the idempotent email receipt and guarded Dotypos warehouse deduction. Neither side effect delays or changes the terminal paid state.

An ambiguous Nexi creation failure retains the created attempt and prevents a second charge until provider reconciliation determines the outcome. A definitive rejection may mark it failed and permit a new attempt.

### Order state

- Payment state: `not_started | pending | paid | failed | cancelled | expired`
- Attempt state: `created | pending | paid | failed | cancelled | expired`
- Receipt delivery: `not_started | processing | sent | failed`
- Dotypos stock synchronization: `not_started | processing | synced | ambiguous | failed`

Paid is terminal for payment. Receipt delivery and Dotypos stock synchronization are allowed only for paid orders and recover independently. A payment session issued before entitlement expiry may reconcile afterward; recovery may not create a replacement session without a fresh entitlement check.

### Receipt delivery

- Render one localized transactional HTML/plain-text email from the immutable order snapshot. Do not generate or attach a PDF, expose a document download, or introduce a generic document renderer in the first release.
- Cart edits, catalog reads, quotes, order creation, payment-session creation, and pending/failed/cancelled payment states never send a receipt.
- The first server-verified transition to `paid` creates or wakes one receipt-delivery job. Return-first and webhook-first races converge on the same paid transition and deterministic receipt idempotency key.
- The receipt uses the immutable accepted items, amounts, currency, seller identity, and order tax-regime snapshot. Initially it identifies Desktechub as a non-VAT payer and contains no VAT breakdown; the dormant VAT-payer branch renders its required captured tax facts.
- Resolve the recipient email from the order's Dotypos customer at delivery time. Do not persist or log the address or rendered email body. Store only the provider message ID, normalized delivery state/code, attempts, and timestamps.
- A send failure never changes `paid`, never triggers another charge, and never blocks stock synchronization. Retry through guarded fulfillment and expose a safe receipt-pending/failed state plus support action to the owning customer.
- Customer-facing recovery links use `workspace@deskohub.cz` and may prefill only the public support reference and normalized issue category. They never place tokens, provider IDs, raw order IDs, email addresses, or cart/receipt content in a `mailto:` URL.

## 10. Dotypos stock synchronization

After Nexi payment is verified, decrement inventory directly with `POST /v2/clouds/:cloudId/warehouses/:warehouseId/sales`. This is a warehouse operation, not a POS checkout. Request facts to validate and encode in the generated client:

- Configured Dotypos warehouse ID owned by the Desktechub inventory process.
- Currency `CZK` if the live contract requires or defaults it.
- Items containing the accepted Dotypos product ID and purchased quantity.
- A non-PII note containing the stable Deskohub purchase order reference only if live verification proves it appears in an independently queryable stock log.

The generated-client verification is a launch prerequisite. Before implementing automatic stock synchronization, use the Dotypos integration workflow and a non-production warehouse to verify:

- Supported `OPTIONS` capabilities, permissions, and exact request/response shape.
- Whether the endpoint is synchronous in practice and what a timeout after application means.
- Whether the item note/order reference appears in a readable stock log or `STOCKLOG` webhook.
- Whether the API offers any undocumented/request-header idempotency behavior.
- Exact quantity units, packaging/ingredient behavior, overdraft behavior, and multi-item atomicity.
- Which warehouse contains the self-service fridge stock.
- How refunds/restocking should reverse a previously completed deduction.

### Failure and recovery

- Persist only normalized outcome, warehouse reference, attempt timestamps, and stable error code. Do not persist raw response bodies or customer-authored notes.
- Retry only definitive pre-application failures automatically. A timeout or lost response is `ambiguous` until a stock log/webhook or other verified provider fact proves whether deduction happened.
- Never infer success from a raw stock quantity delta because unrelated sales/restocking may happen concurrently.
- Permanent failures enter `failed`, remain visible to staff, and trigger an internal alert.
- Customer APIs and screens never expose stock-sync state, retry state, failures, or alerts. A paid order remains “Payment confirmed” regardless of backend synchronization state and never asks the customer to pay again.

## 11. API contract

Create a platform-neutral `@deskohub/workspace-mobile-api` package using Effect Schema/HttpApi contracts protected by a Neon Auth capability that derives the account subject and optional valid Dotypos link. Serve it from an independently addressable versioned Workspace route. The Expo client may use a thin `fetch` transport initially, but every request/response is decoded against the shared contract.

Endpoints:

| Method | Path | Authentication | Purpose |
| --- | --- | --- | --- |
| GET | `/api/v1/mobile/account` | Neon Auth session | Verified account, link state, safe CSRF capability for web, and current entitlement summary |
| GET | `/api/v1/mobile/catalog` | Neon Auth session + valid link + entitlement | Mobile catalog with ETag/version |
| POST | `/api/v1/mobile/quotes` | Neon Auth session + valid link + entitlement; PWA CSRF protected | Fresh authoritative cart review |
| POST | `/api/v1/mobile/orders` | Neon Auth session + valid link + entitlement; PWA CSRF protected | Persist accepted quote/order idempotently |
| POST | `/api/v1/mobile/orders/:id/payment` | Neon Auth session + valid link + entitlement for new attempt; PWA CSRF protected | Create or recover Nexi HPP |
| GET | `/api/v1/mobile/orders` | Neon Auth session + valid link | Linked Dotypos customer's purchase history |
| GET | `/api/v1/mobile/orders/:id` | Neon Auth session + valid link and Dotypos-customer ownership | Reconciled customer-facing payment and order status; excludes stock synchronization |
| GET | `/mobile/payments/return/:id` | Provider browser | Safe Nexi return and canonical HTTPS PWA/Android App Link redirect |
| GET | `/mobile/android/releases/latest.json` | Public, cacheable | Authoritative release metadata for the APK self-updater; contains no customer data |
| GET | `/mobile/android/releases/latest.apk` | Public, cacheable redirect | Product-specific stable website download that resolves to the exact immutable Android release asset |
| POST | `/api/webhooks/nexi/mobile-shop` | Provider webhook | Normalize, verify, and finalize purchase payment |
| POST | `/api/webhooks/dotypos/stock-log` | Secret/provider boundary | Correlate stock changes when supported and trigger verification |

Error vocabulary:

- `unauthorized`
- `commerce_identity_unavailable`
- `no_active_reservation`
- `catalog_unavailable`
- `invalid_cart`
- `quantity_limit_exceeded`
- `catalog_changed`
- `idempotency_conflict`
- `payment_pending`
- `payment_unavailable`
- `order_not_found`
- `order_not_owned`

Public errors must be safe and localized by the app. Domain/provider errors retain causes internally but do not own HTTP copy/status.

## 12. Persistence model

Do not shoehorn shop orders into `workspace_reservations` or duplicate Neon Auth persistence. Create separate purchase lifecycle tables and reuse provider/domain code below the persistence boundary.

### Identity and account-link persistence

- Neon Auth owns customer identities, verification, credentials, and sessions. Its provider-managed schema is not duplicated or treated as an application-owned mobile session table.
- The merged customer-account domain owns `customer_account_links`; this specification adds no parallel email mapping. Mobile services consume its typed repository/capability.
- Purchase and fulfillment tables reference the Dotypos customer that owns the commerce record, not a deletable Neon Auth account row. They may record a non-owning safe audit/correlation fact only when the account-domain retention contract explicitly permits it.
- Deleting a Neon Auth account removes/revokes its link according to the account-domain workflow and cannot cascade into purchase orders, payment attempts/events, receipts, refund annotations, or stock attempts.
- No commerce table persists email, name, phone, device advertising ID, raw auth credential, or push token for MVP. Receipt delivery resolves the current email transiently from Dotypos.

### `purchase_orders`

- `id`, `correlation_id`
- `dotypos_customer_id`
- `authorizing_dotypos_reservation_id`
- bound checkout idempotency key/fingerprint
- payment state, receipt-delivery state, Dotypos stock-sync state, active attempt ID
- total integer value, exponent, currency, quote fingerprint
- accepted locale (`cs-CZ | en-US`) for item snapshots, Nexi presentation, and idempotent receipt rendering
- immutable versioned seller tax-regime snapshot
- paid/failed/cancelled/expired/receipt-sent/synced/failure timestamps and normalized codes
- created/updated timestamps

Stock-sync fields are an internal persistence and staff-operations contract. Customer-facing order DTOs must omit them entirely.

### `purchase_order_items`

- order/line ID
- Dotypos product ID, category ID, and version
- canonical/display name snapshot and locale
- quantity
- unit and line final integer amount, exponent, currency
- tax snapshot discriminated by the order regime: `{ kind: "not-applicable" }` initially, or future `{ kind: "vat", rate, netAmount, taxAmount, finalAmount }`
- optional unit/packaging label

Names, final item prices, and tax snapshots are not customer PII and must remain immutable even if Dotypos or Desktechub’s later tax status changes.

### `purchase_payment_attempts`

Use the existing payment-attempt state and fields but a shop-owned foreign key. Keeping it separate avoids destabilizing the reservation checkout lifecycle. Extract truly provider-neutral transition helpers instead of duplicating Nexi protocol logic.

### `purchase_webhook_events`

Store only dedupe identity, associated purchase attempt/order IDs, normalized processing state/code, and timestamps. Never store the raw Nexi envelope.

### `purchase_receipt_deliveries`

Store order ID, deterministic receipt-version idempotency key, provider message ID, normalized state/result code, attempt count, and timestamps. Do not store the recipient email or rendered subject/body. The order's immutable tax snapshot is the receipt source; retries must reproduce the same email version. There are no attachment bytes or generated documents.

### `purchase_stock_attempts`

Store order ID, warehouse ID/reference, normalized state/result code, attempt count/timestamps, and normalized failure code. If live verification yields a stable stock-log/transaction ID, store it uniquely. Never store raw Dotypos responses or customer-authored notes.

## 13. PWA and Android architecture

Use `apps/deskohub-workspace-mobile` in the existing Bun/Turborepo workspace.

Implementation baseline:

- Stable Expo SDK 57, React Native 0.86, React 19.2, and the stable Expo Router stack. Expo’s current compatibility table is in the [Expo SDK reference](https://docs.expo.dev/versions/latest/).
- TypeScript strict mode and generated typed Expo routes.
- Expo Router for one file-based route tree across Android and web, including static web export and verified Android App Links.
- Serve the PWA at `https://app.workspace.deskohub.cz` and its `/api/v1/mobile` facade from that same origin, using deployment rewrites to the existing Workspace backend where needed. This keeps PWA cookies host-only, avoids third-party-cookie/CORS dependence, and gives Android App Links one canonical domain.
- Platform auth adapter over Neon Auth: provider-supported SecureStore-backed mobile session material on Android and Neon Auth's secure web-session integration on the PWA. Neither adapter creates an application-owned session.
- Expo WebBrowser for Android Nexi HPP, normal full-page redirects on web, and Expo Linking/Android App Links for native returns and magic links.
- React Native `StyleSheet` plus an extracted Deskohub token package, with responsive web breakpoints where the layout needs them. Avoid introducing another cross-platform component framework solely to claim reuse.
- A mobile-owned Paraglide Czech/English message catalog plus the platform-neutral parts of shared `@deskohub/i18n`; a small Android/web locale-storage adapter connects device/browser detection and the persisted override to the Paraglide runtime.
- An app-owned analytics capability with the existing PostHog event-safety contract: `posthog-js` and the current consent integration on PWA, `posthog-react-native` with `defaultOptIn: false` on Android, and the existing server `PostHogEventService` for best-effort lifecycle observations.
- Local `useReducer`/context for the small cart; a platform storage adapter persists only non-sensitive cart/order-resume IDs and cached catalog through AsyncStorage on Android and browser storage on web.
- PWA production build: `expo export -p web`, web manifest/icons, and the app-owned versioned service worker. Cache the app shell and safe static assets only; never cache Neon Auth, payment/order APIs, receipt state, or other private API responses. Expo’s current workflow is documented in [Progressive web apps](https://docs.expo.dev/guides/progressive-web-apps/).
- Android production build: Expo prebuild plus Gradle on GitHub Actions produces a signed APK with one long-lived protected release key. EAS Build and EAS Submit are not part of the binary pipeline, and MVP produces no AAB.
- Set the production Expo/Android application ID to exactly `cz.deskohub.workspace`. Disposable preview builds use a per-PR/per-SHA non-production application ID and ephemeral signing identity and can never be promoted as production upgrade artifacts.
- Host `https://app.workspace.deskohub.cz/.well-known/assetlinks.json` with `cz.deskohub.workspace` and the release-certificate SHA-256 fingerprint so canonical auth/payment links open the installed APK and otherwise remain in the PWA.
- PWA deployments precache a new version in the background and activate it at the next safe navigation/reload. Android includes `expo-updates` and `expo-background-task` in the first APK: signed compatible JavaScript/assets download automatically through staged EAS Update channels and activate at the next safe cold start. Native-runtime changes always require a newly signed APK with a higher `versionCode`.

Do not use Expo Router’s experimental stack for production. Do not put Effect services, Dotypos, Nexi, database, or server config in the client bundle.

### Direct APK distribution

- Retain the Android application ID and release signing key for the lifetime of the app. Back up the keystore securely with documented recovery ownership; losing or changing it prevents installed users from upgrading in place.
- Publish each APK at an immutable HTTPS URL and publish a small public release manifest containing version name, monotonically increasing `versionCode`, minimum supported version, file size, SHA-256 checksum, release date, and official download URL.
- Publish product-specific stable routes at `https://app.workspace.deskohub.cz/mobile/android/releases/latest.json` and `/mobile/android/releases/latest.apk`. The manifest route selects and validates the newest immutable Android release by its dedicated tag prefix; the APK route redirects to that release's exact immutable asset. Do not use GitHub's repository-wide `/releases/latest` pointer because other Deskohub products publish releases in the same repository.
- The Android client reads that manifest only for rare native-runtime upgrades. Compatible JavaScript/UI/assets releases use EAS Update and do not invoke the APK updater.
- Include the self-update native module/config plugin, background downloader, package-install permission, and installer result handling in the first public APK; these capabilities cannot be added later through a JavaScript-only update.
- Download a replacement APK from its immutable official URL into app-private temporary storage only while Android reports an unmetered Wi-Fi connection. Pause cleanly when that condition disappears and resume later without restarting the file. Never accept an APK URL from navigation, push content, API error text, or other untrusted input.
- Before installation, verify expected file size and SHA-256, Android application ID, strictly higher `versionCode`, and APK signing-certificate digest against the release identity compiled into the app. Delete any failed or superseded artifact.
- When the verified APK is ready and no checkout/payment is active, invoke Android’s package installer. Guide the user through the one-time “install unknown apps” permission or confirmation when Android requires it; resume the same update afterward.
- Record only non-PII release/update state and normalized failures. Delete the staged APK after success, rejection, expiry, or terminal failure.
- The website download page remains the recovery path and explains Android’s sideload warning and manual upgrade steps. Never mirror production APKs on ad hoc file-sharing URLs.
- DNS, TLS, deployment ownership, CSP/connect-src, canonical redirects, and service-worker scope for `app.workspace.deskohub.cz` are production prerequisites. Never permit a preview hostname to issue production sessions, host production App Link association, or appear in a production Nexi return URL.
- The PWA may remain technically reachable in browsers outside the supported matrix, but there is no iPhone-specific development, QA, support promise, or native iOS build.

### CI and release contract

#### Per-PR preview APK

1. Start when an eligible internal, non-draft pull request is opened, updated, reopened, or marked ready. Wait for and verify its exact 40-character head SHA and matching successful immutable Workspace Vercel deployment; retain `vercel.deployment.success` and manual dispatch as idempotent and recovery triggers.
2. Reuse the existing Neon/Vercel lifecycle: resolve the unique non-primary `preview/<internal-head-ref>` Neon branch, mask its direct and pooled URLs, migrate it with the direct URL, and never fall back to production or shared development. The APK receives no database credential; its API origin is the exact preview deployment already connected to that branch.
3. Provision preview access in a privileged job that never checks out or executes PR code. The current project-wide Vercel automation-bypass secret must never be passed to the build job, embedded in an APK, written to an artifact, or accepted by the app.
4. Before enabling downloadable previews, prove on a real Android build that a short-lived, deployment-scoped Vercel Shareable Link can establish and retain preview access for the native HTTP client, Neon Auth link return, and payment-return path. If that device spike fails, use a dedicated unprotected-but-application-authenticated mobile preview origin containing synthetic data; do not weaken the production project or embed the global bypass secret.
5. In an unprivileged job, check out the exact head SHA, install the frozen Bun workspace, run Expo prebuild, and compile with Gradle. Use `versionName` and the build tag equal to the full Git SHA, a monotonically usable CI-only `versionCode`, a visible PR/SHA preview banner, a preview-only callback scheme, and disposable application ID `cz.deskohub.workspace.preview.pr<PR>.s<shortSHA>` signed by an ephemeral key.
6. Verify the APK signature, application ID, full-SHA version name, version code, file size, and SHA-256; attest it; then upload the APK, checksum, and decoded metadata as a seven-day GitHub Actions artifact named with the PR and SHA. Publish a commit status or updated PR comment pointing to the authenticated artifact. Preview builds never create Git tags or GitHub Releases.

#### Production APK

1. Run only for the exact trusted `main` SHA after the staged Workspace production deployment has built successfully, the production Neon branch has migrated, and Vercel has promoted that deployment. Serialize production mobile releases without cancellation.
2. If immutable tag `deskohub-workspace-android-<fullSHA>` already exists, verify it and exit idempotently. Otherwise allocate `versionCode` as one greater than the newest valid mobile release manifest and set both Android `versionName` and the release build tag to the full promoted Git SHA.
3. Build `cz.deskohub.workspace` with the permanent production signing key supplied only through a main-restricted, reviewer-protected GitHub environment. Keep the keystore in runner-temporary storage, compare the resulting certificate SHA-256 with the pinned public release identity, and retain a separately protected offline backup.
4. Verify and attest the APK, generate its checksum and release manifest, create a draft GitHub Release, upload `deskohub-workspace.apk`, its checksum, and manifest, then publish it as an immutable release without claiming the repository-wide `latest` marker.
5. The product-specific Deskohub manifest/redirect routes become the only public update-discovery boundary. The website links to the stable APK redirect; the self-updater consumes the stable JSON manifest and still verifies the downloaded APK's size, hash, package, higher `versionCode`, and signing certificate.

The production job uses GitHub environment `workspace-mobile-production`, `contents: write`, `id-token: write`, and `attestations: write`. Its only Android signing secrets are `WORKSPACE_ANDROID_KEYSTORE_BASE64`, `WORKSPACE_ANDROID_KEYSTORE_PASSWORD`, `WORKSPACE_ANDROID_KEY_ALIAS`, and `WORKSPACE_ANDROID_KEY_PASSWORD`; public variables include `WORKSPACE_ANDROID_RELEASE_CERT_SHA256` and `WORKSPACE_ANDROID_APPLICATION_ID=cz.deskohub.workspace`. None is available to the PR build job.

Direct Gradle builds do not require an Expo credential. EAS Update is a separate launch prerequisite: provision the Expo project, `EXPO_TOKEN`, preview/production channels, runtime-version policy, protected update-signing key, and verification certificate before the first public APK. The initial APK must already contain the configured and code-signature-enforcing `expo-updates` runtime; compatible updates may then use any connection while native APK replacements remain restricted to unmetered Wi-Fi.

### Automatic update policy

- Maintain preview and production EAS Update channels. Publish to preview, run the exact release APK matrix, then promote the same signed update with staged rollout and monitored rollback capability.
- Sign over-the-air updates end-to-end with a protected private key and embed only its verification certificate in the APK. A bad or unsigned update is rejected; key backup and rotation are operational runbooks.
- Use a manually controlled Android native `runtimeVersion` that changes only when native dependencies or native configuration change. CI fails when native inputs change without a runtime-version bump and new APK plan.
- Check for updates at cold launch and foreground. Register a best-effort, battery-aware background task to check and download compatible EAS updates over any connection; constrain full APK transfer to unmetered Wi-Fi. Background execution is not guaranteed by Android.
- Never reload the app to activate an update while a cart submission, hosted payment, return reconciliation, or receipt status transition is active. Apply a downloaded update on the next safe cold start; an urgent compatibility gate may block starting a new payment, but never interrupts one already underway.
- Keep the native dependency surface deliberately small. Prefer server/API, JavaScript, asset, and PWA changes so ordinary releases require no APK replacement.
- For an unavoidable native change, the app fetches the release manifest, downloads and verifies the new signed APK in the background, then starts the Android installer at a safe foreground moment. Android may require user approval unless the device/install context qualifies for unattended package installation; always handle and resume the confirmation path.

Native APK update state: `not_checked | up_to_date | available | waiting_for_wifi | downloading | verifying | ready | awaiting_permission | awaiting_confirmation | installing | installed | failed`.

### Reuse matrix

| Reuse directly | Extract/adapt | Rebuild cross-platform |
| --- | --- | --- |
| Dotypos/Nexi/email/PostHog server packages; Prague Temporal helpers; Effect schema conventions; i18n value resolver | Catalog projection; exact money/domain types; API contract; price/status presentation; design tokens/assets; provider-neutral payment and analytics operations | Shared Expo screens/navigation/product cards/cart/forms/status UI, plus small Android/web adapters for auth storage, hosted payment, analytics consent, linking, installation, and updates |

## 14. Security, privacy, and abuse controls

- Apply the repository no-PII rule outside Neon Auth to account links, orders, analytics, jobs, and logs. Neon Auth owns account identity data; Dotypos remains the commerce customer/profile owner.
- Never store or log raw Neon Auth credentials or magic links, email HTML/text, Nexi customer info, security tokens outside the guarded attempt field, provider bodies, card data, or raw Dotypos stock-operation bodies.
- Mark sensitive database parameters and suppress tracing around any confidential scalar.
- Enforce TLS, exact allowed PWA origins, verified Android App Links, strict result/cancel URL construction, and no arbitrary redirects.
- The native updater trusts only the compiled official release origin, Android application ID, and release-certificate digest; it verifies manifest facts and the downloaded APK before invoking the system installer.
- For PWA cookie-authenticated mutations, require the expected `Origin`/Fetch Metadata plus the CSRF protection required by the Neon Auth integration. Android provider-token requests do not use cookie ambient authority.
- Neon Auth owns constant public identity responses, rate limits, single-use email-link expiry, credentials, and session revocation; Workspace adds no parallel token implementation.
- Check the account link, Dotypos-customer order ownership, and current entitlement on the server. The app cannot submit an account, Dotypos customer, or reservation ID as authority.
- Never embed a Vercel protection-bypass secret, Neon Auth administrative credential, production signing key, database URL, or provider secret in an Android/PWA bundle or CI artifact.
- Bind idempotency to normalized content and reject replay with different inputs.
- Verify all Nexi outcomes through Nexi GET before paid/terminal transitions.
- Treat stock-log webhook callbacks as triggers; correlate and verify provider facts before marking a deduction synced.
- Use synthetic customer/order data in preview and tests. Production provider diagnostics require the Workspace operations workflow.
- Obtain privacy/legal review for website/PWA/APK disclosures, purchase terms, receipt delivery, retention, Android sideload instructions, and any analytics before release.

### PostHog analytics and consent

- Use the same Workspace PostHog project, deployment-environment property, public ingestion configuration, URL/property sanitizer, event naming governance, and server-side `PostHogEventService`. PostHog availability or event delivery never gates login, entitlement, catalog, payment, receipt, stock synchronization, or administration.
- PWA reuses the current localized consent categories and `cc_cookie` behavior. Android presents the same localized categories through a native consent/preferences screen and persists the choice locally. Consent is per browser/app installation in MVP rather than silently copied between devices.
- Client analytics start opted out. Only an explicit acceptance of the `analytics` category enables capture, screen analytics, tracing correlation, or session replay. Withdrawal stops capture/replay, removes correlation headers, resets the anonymous PostHog state, and clears queued client analytics as supported and verified by the platform adapter.
- Keep client collection anonymous. Do not call `identify` with email, name, phone, Dotypos customer/reservation ID, Neon Auth account/session identifiers, order ID, payment ID, or another stable account identifier. Logout resets the anonymous SDK state without changing the customer's separately persisted consent choice.
- Capture only allowlisted, versioned screen names and event properties. Never send route parameters, query strings, magic links, cart text, item names, receipt content, support text, auth/payment tokens, provider payloads, or free-form errors. The sanitizer drops an event that contains an unknown property rather than forwarding it.
- PWA session replay follows the current consent-gated configuration with all inputs and body text masked. Android product analytics uses `posthog-react-native` with automatic touch capture disabled and manual parameter-free Expo Router screen events. Because React Native replay is screenshot-based, Android replay remains disabled until real-device verification proves that authentication, cart/order/history, and payment-return surfaces are excluded and all remaining inputs/images are masked.
- Server lifecycle events remain best-effort operational observations keyed by safe internal event/order IDs, not a customer profile. Durable database state and audited administration history remain authoritative if PostHog is absent, delayed, sampled, or deleted.
- Use the existing project token/host environment contract; public client bundles contain only the public ingestion token. Management/query keys, source-map credentials, and other PostHog secrets remain server/CI-only.

## 15. Reliability, observability, and operations

### Operational events

Use non-PII IDs and normalized event names:

- `customer_auth_verified`, `customer_auth_failed`, `customer_auth_session_revoked`, observing normalized Neon Auth outcomes without credentials or account PII
- `mobile_account_link_missing`, `mobile_account_link_ambiguous`, `mobile_account_link_resolved`, deduplicated by safe account/link/Dotypos IDs and never carrying the submitted email
- `mobile_entitlement_granted`, `mobile_entitlement_denied`
- `shop_catalog_loaded`, `shop_quote_changed`
- `shop_order_created`, `shop_payment_started`, `shop_payment_paid`, terminal unsuccessful variants
- `shop_receipt_queued`, `shop_receipt_sent`, `shop_receipt_failed`
- `shop_stock_sync_started`, `shop_stock_synced`, `shop_stock_sync_ambiguous`, `shop_stock_sync_failed`
- `client_update_checked`, `client_update_downloaded`, `client_update_applied`, `client_update_failed`, carrying only platform/runtime/version identifiers

Never attach email, name, phone, raw cart copy, tokens, or provider payloads. Product IDs and aggregate counts/totals are permitted only after analytics/privacy review.

### Dashboards and alerts

- Neon Auth verification/session rate and normalized error classification.
- Account-link resolution, locked-commerce, eligible-session, and catalog-load rate.
- Nexi creation, pending age, terminal result, and verification mismatch.
- Paid orders with pending/failed receipt delivery and oldest retry age.
- Paid orders awaiting Dotypos stock sync, oldest pending/ambiguous age, permanent failures, and duplicate prevention.
- Catalog parse/filter errors and Dotypos latency/availability.
- Android crash-free sessions, runtime/update adoption, download/apply/rollback failures, and supported APK versions; PWA error-free sessions, service-worker adoption, and Core Web Vitals.

Alert immediately on payment verification mismatch, evidence of a duplicate stock deduction, or paid-order data invariant failure. Alert operationally when receipt delivery remains unsent past its retry threshold or a paid order has not synced to Dotypos within five minutes.

### Staff surface

Extend Workspace administration for existing Workspace administrators with a purchase list/detail that exposes safe IDs, item/amount/tax-regime snapshots, payment timeline, receipt-delivery state, stock-sync state, and guarded recovery. Do not create a separate mobile-shop staff identity or role in MVP. It must not expose auth tokens, payment security tokens, provider payloads, or customer contact data.

Missing/ambiguous link incidents, guarded relinking, and account deletion stay in the customer-account administration boundary delivered by the prerequisite branch. Purchase administration may navigate to that safe account/link record but cannot mutate `customer_account_links` through a purchase-recovery action.

Payment re-verification, receipt resend/retry, refund reconciliation annotation, and stock-sync retry/resolution are separate explicit actions with confirmation, current-state preconditions, idempotency protection, actor/timestamp audit records, and normalized reason/result codes. Administrators cannot mark an unverified payment as paid or blindly retry an ambiguous warehouse deduction.

Refund initiation is not in MVP. Document the Nexi/Dotypos correction procedure and how the local order is annotated/reconciled after an operator completes it.

## 16. Testing and verification

### Automated layers

- Pure/domain tests: money parsing, catalog filters/order, cart normalization and quantity limits, account-link resolution, Prague/DST entitlement, tax-regime unions and transitions, quote fingerprints, idempotency binding, and state transitions.
- Contract tests: every mobile request/response and error decodes through the shared Effect schemas.
- Service tests: Dotypos/Nexi/email/DB test layers, including timeout, retry, ambiguity, cancellation, price/tax-regime change, receipt delivery, and duplicate callbacks.
- Database tests: account-link uniqueness/ambiguity handling, exact-one terminal transition, immutable item snapshots, no auth/session duplication, no PII-capable commerce columns/raw payload columns, and no account-deletion cascade into retained ledgers.
- Shared component/integration tests with Jest Expo and React Native Testing Library, plus focused tests for Android/web platform adapters.
- Localization tests cover both complete UI catalogs, unsupported-device fallback, persisted override, live language switching, Dotypos full/base/canonical fallback, and immutable paid-receipt language.
- Catalog UI tests cover valid, missing, malformed, failed, and offline product images and verify that every case remains purchasable with the branded placeholder when the product itself is valid.
- PostHog adapter tests prove default opt-out, consent-gated enablement, withdrawal/logout reset, allowlisted schemas, URL/property redaction, anonymous identity, PostHog-outage isolation, and identical privacy outcomes on PWA and Android. Real-device replay tests must fail if any protected screen or sensitive value is visible.
- Asset checks prove Android adaptive/monochrome/splash and PWA manifest/favicon outputs are reproducibly derived from the existing Workspace SVGs; screenshot tests verify light/dark contrast, Sculpin loading/fallback, and shared semantic colors.
- Maestro E2E flows on Android development/release APKs and Playwright browser E2E for the PWA.

### Required E2E stories

1. Any verified Neon Auth account can request an email link, open Android or PWA, and receive a provider-owned session regardless of reservation or link state.
2. A verified account with no valid `customer_account_links` row remains signed in but sees locked commerce, no Dotypos-owned history, and a safe support route.
3. Missing/duplicate/ambiguous account links produce one deduplicated staff incident with safe IDs and cannot expose any candidate Dotypos customer's reservation or purchase history; authentication itself remains available.
4. `NEW` reservation never grants access; `CONFIRMED` does; cancellation revokes it.
5. Prague day boundaries and 23/25-hour DST dates are correct.
6. Product is repriced/hidden between catalog and Pay; refreshed review appears and no charge starts.
7. A valid product with no usable image remains visible and purchasable with the bundled placeholder on Android, PWA, and offline catalog views.
8. Double tap/retry yields one order and one Nexi session.
9. Nexi success through return first and webhook first both yield one paid transition and exactly one idempotent receipt delivery.
10. App closes during HPP and resumes the existing pending/paid order.
11. Payment succeeds while Dotypos is temporarily unavailable; customer sees paid, and recovery later performs exactly one warehouse deduction.
12. A lost/ambiguous warehouse-sale response is not blindly retried and cannot silently deduct stock twice.
13. A session whose account links to another Dotypos customer cannot read the order.
14. Two independently signed-in Neon Auth sessions for the same linked customer can use the shop concurrently; logging out one follows provider session semantics without granting either access to another customer's orders.
15. Adding or editing cart items, quoting, and entering pending payment never sends a receipt; verified payment sends it.
16. Receipt delivery failure leaves the order paid and retries without another charge or duplicate receipt.
17. A non-VAT order omits tax details, while the dormant VAT-payer contract requires complete tax details and preserves both regimes immutably.
18. Offline users can browse the last validated catalog and edit a persisted cart, see its last-updated state, and cannot quote, pay, or create a purchase until reconnection and server revalidation.
19. Neon Auth's PWA email-link flow creates its secure web session; wrong-origin or missing-CSRF mutations are rejected, and Workspace creates no parallel auth/session row.
20. PWA refresh/new-tab return and Android App Link return both resume the same pending/paid order.
21. The web manifest is installable, service-worker updates recover safely, and authenticated/payment responses never enter browser or service-worker caches.
22. The Android self-updater accepts only the official Deskohub HTTPS release manifest/artifact and rejects a wrong checksum, package ID, version direction, or signing certificate.
23. A correctly signed compatible Android update downloads without manual APK action and activates only outside an active payment; invalid, bad, or runtime-incompatible updates never replace the working version.
24. A native update waits on mobile/metered connectivity, downloads and resumes only on unmetered Wi-Fi, pauses installer launch during checkout, survives the one-time Android source-permission/confirmation round trip, and upgrades in place without the user locating the APK.
25. Czech and English work on Android and PWA; an explicit language choice survives restart/update, unsupported device/browser locales fall back to English, and changing language after payment does not alter a retried receipt.
26. A signed-in account with one valid customer link but no reservation today can open only that Dotypos customer's purchase history and resume existing payment reconciliation, but cannot load the live catalog, quote a cart, create an order, or start a new payment.
27. Every reservation-family confirmation email contains the localized canonical public shop link with no customer-specific data; it opens the installed Android app or falls back to the PWA and never authenticates the recipient by itself.
28. The client exposes no numeric-code exchange UI or Workspace auth endpoint; requesting another Neon Auth email link on a second device follows provider semantics without creating a mobile auth table.
29. An existing Workspace administrator can inspect and safely recover payment, receipt, refund-reconciliation, and stock-sync issues; a customer or unauthenticated caller cannot access any administration data or action, and every manual action is audited.
30. PWA and Android send no client PostHog event before analytics consent; consent enables only allowlisted anonymous events, withdrawal stops future capture and correlation, and PostHog failure never changes a commerce result. Android session replay remains off until its protected-screen privacy matrix passes on a release APK.
31. PWA and Android stop incrementing at 10 units of one product or 30 total units, and server quote/order APIs reject direct or duplicate-line attempts to exceed either limit without creating an order or payment attempt.
32. Android and PWA display the existing Deskohub mark, Sculpin typography, and shared Workspace palette from one source package across light/dark and install/launch surfaces, with no newly drawn DW icon or duplicated drifting token set.
33. Production magic links and Nexi returns use `https://app.workspace.deskohub.cz`, whose `assetlinks.json` opens `cz.deskohub.workspace`; the PWA uses its same-origin API facade, and preview/foreign origins cannot receive production sessions or callbacks.
34. Support actions across PWA, Android, receipts, history, and the download page address `workspace@deskohub.cz` and include at most the safe public support reference—never a token, provider ID, customer email, or raw purchase payload.
35. Deleting a Neon Auth account revokes/removes its customer link and access but leaves Dotypos-owned purchase, payment, receipt, refund-reconciliation, and stock ledgers intact and not reassigned.
36. A PR preview APK is built only after exact-SHA Vercel/Neon preview validation and migration, contains the exact preview origin and full SHA build identity, uses a disposable application ID/ephemeral signature, and contains no Vercel bypass or database/provider secret.
37. A production APK is built only from the promoted `main` SHA, uses `cz.deskohub.workspace` and the permanent certificate, carries the full SHA version name/build tag plus a higher version code, and is published as an attested immutable product-specific release.
38. The product-specific latest manifest/redirect never resolves a DHW or other repository release, and the first public APK rejects unsigned EAS updates and untrusted native replacement artifacts.

Visible UI work must include exact PWA viewport screenshots and Android emulator/device screenshots for each new state. Verify browser zoom/reflow, keyboard navigation, supported screen readers, service-worker refreshes, Android font scaling, App Links, SecureStore, mail-app behavior, sideload installation, and signed APK upgrades on real Android hardware.

## 17. Implementation plan

### Phase 0 — hard launch prerequisites and provider proofs

1. Review and merge the customer-account branch. Verify that Neon Auth is the sole identity/session authority, `customer_account_links` is the sole mapping, link uniqueness/failure behavior is typed and audited, and account deletion cannot cascade into commerce ledgers. No mobile auth, schema, or API implementation starts before this passes.
2. Approve Desktechub's Czech/English seller, non-VAT receipt, purchase-terms, privacy/retention, refund/support, and Android sideload wording; record the Nexi merchant and target Dotypos warehouse owners.
3. Verify the configured Desktechub Dotypos cloud's final-price field mapping with representative synthetic/non-production `self-service` products.
4. Run the controlled Dotypos warehouse-sale/stock-log spike, verify capabilities and recovery on non-production data, update the OpenAPI contract, regenerate the client, and prove the generated operation rather than hand-writing an HTTP call.
5. Test Nexi return through ordinary PWA HTTPS navigation, production-shaped Android App Links, and preview-only callback fallback.
6. Test Neon Auth email links against real email link scanners, PWA routing, Android App Links, multiple devices, revocation, and account deletion.
7. Prove the short-lived Vercel Shareable Link on a real preview APK without exposing the project-wide bypass secret; if native session continuity fails, provision the dedicated synthetic-data mobile preview origin before enabling PR artifacts.
8. Provision the main-restricted Android signing environment and offline key backup, register the permanent package/certificate for direct Android distribution, create the Expo/EAS Update project and signed channels, and provision `app.workspace.deskohub.cz` DNS/TLS/rewrite ownership.

Exit: the account branch is merged, legal/operational text is approved, non-production provider paths are proven through generated clients, preview access is safe, and signing/EAS/DNS identities are recoverable.

### Phase 1 — shared contracts and prerequisites

1. Add `@deskohub/workspace-mobile-api` contracts and typed errors.
2. Establish the mobile Paraglide project/catalogs and Expo-compatible locale adapter, reusing platform-neutral `@deskohub/i18n` helpers and translation linting.
3. Extract exact money, the versioned seller tax-regime union, and mobile catalog projection into the appropriate shared domain boundary.
4. Add paginated category/product reads and explicit self-service filtering.
5. Remove email-body logging or add a safe receipt-delivery operation.
6. Consume the merged customer-account capability and create only purchase/fulfillment schemas and migrations, with no-PII and account-deletion retention tests.
7. Extract the shared PostHog event/sanitizer contract and add PWA/Android consent adapters, both defaulting to analytics off.
8. Extract the Workspace brand assets and semantic tokens into a shared package, then generate Android/PWA icon and splash derivatives from the canonical SVGs.

Exit: contracts compile in server and Expo contexts; migrations and domain tests pass.

### Phase 2 — authentication and entitlement

1. Integrate the Neon Auth client/server adapters and validate provider-owned sessions at the mobile API boundary without adding auth persistence.
2. Consume `customer_account_links`, implement fail-closed link resolution, and add the confirmed-customer reservation overlap operation.
3. Implement the provider-supported HTTPS email-link landing, PWA web session, Android SecureStore adapter, logout, revocation, and account-deletion handling.
4. Add separate link-missing/link-ambiguous/no-reservation locked states and reservation cancellation rechecks.
5. Build Neon Auth sign-in/check-email/account, locked, and settings screens.
6. Add the localized public shop call to action to every reservation-confirmation email and enable it only when the production app landing and support path are ready.

Exit: verified-account, linked/unlinked/ambiguous, eligible/ineligible, account-deletion, DST, and cancellation cases pass backend and device E2E with no parallel auth state.

### Phase 3 — catalog and cart

1. Implement authenticated catalog service/API, cache, version/ETag, webhook invalidation, and failure behavior.
2. Build the shared responsive PWA/Android shop, search/categories, product detail, platform cart persistence, install affordances, and accessibility.
3. Implement authoritative quote, exact money, fingerprint, expiry, and `catalog_changed` review.

Exit: catalog and cart work in Czech/English, stale display is labeled, and stale data cannot pay.

### Phase 4 — purchase and Nexi lifecycle

1. Implement purchase order/item/payment attempt/event repositories and guarded transitions.
2. Extract/reuse Nexi session creation, verification, return, webhook dedupe, and recovery mechanics.
3. Implement order/payment/status/history APIs, PWA browser and Android App Link HPP return flows, and paid-only idempotent receipt delivery.
4. Build verifying, paid, pending, failed, cancelled, and history/detail screens.
5. Add queue/cron recovery for ambiguous/pending attempts and failed receipt delivery.

Exit: one charge per idempotent attempt and verified paid recovery across app restarts/ordering races.

### Phase 5 — Dotypos warehouse synchronization

1. Implement generated warehouse/product-stock/warehouse-sale operations and configuration.
2. Add the paid-order stock queue, optional stock-log webhook correlation, verified recovery, ambiguity handling, and staff alerts.
3. Add Workspace-administrator purchase detail and separately guarded, audited payment verification, receipt recovery, refund reconciliation, and stock-sync recovery actions.
4. Validate exact quantities, units, multi-item behavior, reversal, and duplicate prevention in non-production.

Exit: every paid order produces exactly one matching Dotypos warehouse deduction and ambiguous/failing outcomes are recoverable.

### Phase 6 — hardening and release

1. Complete privacy/legal website-download metadata, Android sideload instructions, support, and refund runbooks.
2. Complete the exact-SHA PR APK and promoted-main production CI contract in §13, PWA preview/production deployment, manifest/icons/Workbox policy, signed EAS Update channels, protected APK/update signing, safe activation/rollback, native APK self-updater, production `assetlinks.json`, product-specific release manifest/redirect, and native-runtime change gates. There is no EAS Build, EAS Submit, or store submission.
3. Run accessibility, poor-network, supported-browser Playwright, real-Android-device, and Android Maestro matrices.
4. Conduct staff alpha, limited-member beta, then general release with independent auth/order/receipt/stock-sync kill switches.
5. Measure payment success, sync lag, support load, and physical shrinkage before widening the non-alcoholic catalog or adding scanning.
6. Verify consent changes, event redaction, anonymous identity, and session-replay masking/exclusion in the production-equivalent PWA and release APK before enabling PostHog client capture or Android replay for general users.

Exit: launch criteria in §3 are met and operational ownership is acknowledged.

## 18. Acceptance criteria

The MVP is complete when:

- Any verified account can authenticate through Neon Auth's email link independently of reservation/link state; Workspace creates no custom auth request/session and copies no plaintext identity PII into commerce tables.
- Exactly one valid `customer_account_links` association is required for Dotypos-owned history or commerce; missing/ambiguous links fail closed without terminating the Neon Auth account session.
- Commerce unlocks only on an eligible Prague day and reacts to reservation cancellation.
- The app shows only explicitly approved self-service Dotypos products.
- The same feature-complete interface is available in Czech and English through the shared Paraglide workflow; locale detection, persistent override, Dotypos text fallback, Nexi language, and receipt language follow the rules in §7.
- All displayed/reviewed/charged amounts use server-authored exact CZK money.
- The last valid catalog and cart remain usable for offline browsing/editing with clear stale status, while quote/order/payment operations remain unavailable until fresh online validation.
- The user cannot be double charged by taps, retries, returns, webhooks, or app restarts.
- Adding items to a cart never sends a receipt; each server-verified paid order triggers exactly one idempotent email receipt, and delivery failure does not change payment state.
- Current orders and receipts identify Desktechub as a non-VAT payer and omit VAT details, while the versioned domain and persistence contract support activating a validated VAT-payer branch for future orders without reinterpreting history.
- PWA releases refresh safely and compatible signed Android updates download without requiring another APK; update activation cannot interrupt payment. When the runtime truly changes, the Android app downloads and verifies its replacement APK itself and hands it to the system installer without making the user find the file.
- The app shows payment success only after server verification and never presents that state as permission or instruction to collect items.
- Every paid order is either deducted exactly once from the configured Dotypos warehouse or is backend-visible to staff as pending/ambiguous/failed with guarded recovery; none of these states is exposed to the customer.
- The customer can see a safe purchase record and support reference.
- A valid Neon Auth session with one valid link can view that Dotypos customer's purchase history outside reservation days without gaining access to new commerce operations.
- Neon Auth account deletion removes account access/linkage but retains the immutable Dotypos-owned commerce and fulfillment ledgers for the required retention period.
- PWA and Android reuse the consent-gated Workspace PostHog integration without PII or stable customer identity; declining analytics causes no loss of app functionality, and PostHog is never authoritative for payment or fulfillment.
- The MVP requests no camera permission and contains no barcode-scanning SDK or unused client EAN payload; the documented versioned expansion can add scanning later without changing payment semantics.
- Customer-facing Android, PWA, website, email, receipt, and support surfaces consistently use “Deskohub Workspace,” with “DW” limited to compact branding and Desktechub s.r.o. still identified as the seller.
- The app reuses the canonical Workspace logo, Sculpin font, and palette through shared assets/tokens; platform icon variants are reproducible derivatives, not a separate identity.
- Every production APK, release manifest, App Link association, and self-update verification uses `cz.deskohub.workspace`; CI rejects a production build or artifact whose application ID differs.
- Every PR APK is bound to its verified exact-SHA Vercel preview and integration-owned Neon branch, uses the full SHA as version/build identity plus a disposable package/signature, and contains no Vercel bypass or database/provider secret.
- Every production APK is built after promotion from the exact `main` SHA, signed by the permanent protected key, attested, and published through an immutable Android-specific release and product-specific latest manifest/redirect.
- Production PWA navigation, magic links, payment returns, API calls, `assetlinks.json`, and install metadata consistently use `https://app.workspace.deskohub.cz`; preview hosts cannot be accepted as production callback origins.
- Every customer support action and document uses `workspace@deskohub.cz` with a safe public support reference; sensitive identifiers and customer data are never embedded in the generated message URL.
- Czech/English, accessibility, offline/error states, privacy, PWA installability, and direct-APK distribution requirements are satisfied.
- Automated tests cover the critical stories in §16; the implementation is verified in supported PWA browsers and on real Android devices, with no iOS release commitment.
