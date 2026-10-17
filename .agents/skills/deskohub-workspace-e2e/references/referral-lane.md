# Workspace E2E referral cases

## Contents

- [Projects and cases](#projects-and-cases)
- [Seeded sessions](#seeded-sessions)
- [Account identity journals](#account-identity-journals)
- [Referral cookie](#referral-cookie)
- [Assertions](#assertions)

## Projects and cases

- Referral coverage outside the real magic-link flow lives in `e2e/referrals/**`. Its cases are in the checkout catalog (`workspaceE2EReferralCaseIds`, also listed by duration among `workspaceE2ENonPaymentCaseIds`), so planning, per-case journals, HAR, annotations, and teardown work as for any case.
- The referral cases never pay and run in the shared `checkout-cases` pool with every other case. They need no magic link or shared account, so they take no account-lane budget.
- The three unpaid referral checkouts share one planned open-space date, each for its own customer. `bindCheckoutContact` adds `customer=account` to the planned link; its contact fields alone open a signed-in page in "book for someone else" mode, where a remembered code only prefills the box. `cases.pw.ts` binds each case to its seeded identities through `registerWorkspaceE2ECases`' `bindCase`.
- The account lane runs no referral overview, eligibility, or checkout case. Its main-recipient link starts anonymously from the locale-free share link `/account?ref=CODE` of the synthetic `referral-owner`, seeded before any send. Consumption must land on completion with the field prefilled from the remembered cookie; no sign-in, callback, or account URL carries `ref`.
- `checkout-guest-referral` (a paid pool case under the [hosted-payment permit](suite-orchestration.md#hosted-payment-permit)) is the paid guest path: it opens a reservation from `?ref=` with a per-case seeded referrer's code, applies the prefilled code, and pays.

## Seeded sessions

Sign referral-case identities in by seeding a session, never by sending a magic link (`e2e/account/seeded-session.ts`):

- Insert a short-lived `auth.session` row into the exact preview database and set the matching signed `__Secure-better-auth.session_token` cookie (HTTP-only, Secure, Lax, preview origin) in the case's own context with the runner's `cookie set --stdin`. The value travels on command input, and the token and signed value are registered with the redactor.
- Sign with Better Auth's `makeSignature` and the first entry of `WORKSPACE_E2E_BETTER_AUTH_SECRETS`, a copy of the Preview-only `BETTER_AUTH_SECRETS` held only in the protected `workspace-checkout-e2e` environment. Never copy the Production value; rotate the copy with Preview. Referral and administrator cases fail closed without it.
- Admin cases reuse the same session seeding for Playwright contexts (`signInWorkspaceE2ESyntheticBrowserContext`); see [administrator sessions](fixtures.md#administrator-sessions).
- The deployment authenticates the cookie through its normal session lookup; there is no server hook or bypass route. `seeded-session.test.ts` proves acceptance against Better Auth with the shared `authOptions`.

## Account identity journals

- Every referral case journals its synthetic identities in its own account identity journal (`emptyWorkspaceE2EAccountJournal(<case id>)`), derived only from the run id and the case's closed recipient labels (`e2e/referrals/journal-owners.ts`). The paid guest case journals its referrer and guest (`gr-referrer`, `gr-guest`) before payment can attribute them.
- These journals live in `e2e-artifacts/checkout/account-journals`, apart from the checkout case journals in `cleanup-journals`: owners reuse case IDs, and a shared `<case id>.json` let each kind overwrite the other.
- Suite cleanup reconciles the account lane's and every case's journal, including referral rows, seeded paid-history and savings rows, and the Dotypos profiles and visits they own. Auto-link cases create the exact-email Dotypos customer before the unlinked user.

## Referral cookie

- A shared link sets the first-party `deskohub-referral-code` cookie (first link wins). Only the shown top-level page stores it, after hydration and only while the `referrals` flag is on, so open shared links with `openBrowserPage` or `page.goto` and wait for the cookie before navigating away.
- Assert it with the runner's `cookie get --stdin` (`readBrowserCookie`, `e2e/referrals/referral-cookie.ts`), which reports presence, attributes, and whether it holds an expected code, never the value.
- Every referral case and the paid guest case first prove their context starts without it. Cases that open several shared links in one context order them so each meets the cookie state it needs.

## Assertions

- Checkout records the attribution only when the order is paid. Unpaid referral checkouts assert pricing and that no attribution or invitation claim exists yet; the paid guest case asserts the booked customer is attributed and its one active invitation claim is `redeemed` by the paid attempt's 15% application. Its open-space date also carries the [Calendar sale](fixtures.md#calendar-sale-event), so the paid attempt persists the sale first and the invitation second, priced on the sale's remaining subtotal.
- A rejected referral code re-signs the pay state so the typed code stays in the box, so rejection checks expect a new URL for the same order, not the same `payState`.
