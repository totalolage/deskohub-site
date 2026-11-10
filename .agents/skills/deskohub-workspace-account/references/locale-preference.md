# Saved language preference

The saved language is the nullable Better Auth user field `locale`
(`auth.user.locale`, CHECK `en-US`/`cs-CZ`, `input: false`). It's both the
email language and the signed-in site locale. NULL means no preference:
accounts that predate the field have none until their next sign-in. Never
backfill or invent a default.

## Writes

Write code lives in `features/account/backend/customer-locale-preference.ts`
and the hooks in `auth-server.ts`.

- The `user.create.before` hook puts the sign-in locale (else the site
  default) into the user insert, so no new account lacks one.
- Every session creation captures the sign-in locale with an update that only
  matches a NULL locale, so sign-in never overwrites a saved preference. A
  capture failure logs `account-locale-preference.capture-failed` and never
  blocks login.
- The sign-in locale is the callback URL's locale segment, else the app's
  `x-deskohub-locale` header (`customerSignInLocaleHeader`). `/app/` paths
  carry no locale, so the app sends the header on the two requests that can
  create its account: `POST /sign-in/email-otp` and `GET /magic-link/verify`.
  `appSignInLocale` (`native-sign-in.ts`) reads it only on those paths. The
  auth guard refuses any other value than a supported locale with 400
  `INVALID_LOCALE` before it claims the code or link, so a corrected retry
  still works. Never accept the locale as a body or query field: Better Auth
  rejects a `locale` user field on code sign-up after it consumes the code,
  and drops unknown verify query keys.
- The profile language control and the header switcher share `switchLocale`
  (`features/account/switch-locale.ts`); callers pass the
  `updateLocalePreference` Server Action as `save`. It saves under the account
  lock with the deletion-marker recheck, then navigates to the current URL in
  the new locale with a document navigation, even when the save fails.
- The app saves it with the customer API's `PUT /account/locale`
  (`updateLocale`), through `CustomerLocalePreference`: the same
  `saveAccountLocalePreference` section, over sections that read the
  request's authentication (`CustomerAccountSections.ForProvidedAuthentication`).
  It writes no cookie and navigates nowhere; the app applies the language
  itself.
- The action writes no cookie. Next treats a cookie write in a Server Action
  as a revalidation: the save's response re-renders the referring page under
  its old locale, and the client applies it while the document navigation
  leaves the page. Production flashed the error page in that window, and
  previews refetched the old URL into the proxy's locale redirect in a loop.
  The proxy moves the locale cookie on the navigated page's response.
- The profile control shows the page locale. An account without a preference
  gets one when it picks a language or at its next sign-in.

## Reads

- `resolveWorkspaceLocale` (`features/i18n/locale-resolution.ts`) is the only
  locale chain: saved preference, then URL path, cookie, Accept-Language,
  default.
- The proxy applies it to page requests and redirects a mismatching URL.
  Server Actions apply it to the referring page (`features/i18n/server/action-locale.ts`).
  Rendering trusts the URL segment the proxy normalized.
- The preference comes only from the authoritative `CustomerAuthentication`
  read (Better Auth `getSession` with `disableRefresh`) as
  `CustomerAccountSession.localePreference`. `findSavedLocalePreference`
  (`features/account/backend/saved-locale-preference.ts`) takes it from that
  session, so a deletion-pending account keeps its preference. Never read the
  `locale` column yourself on a request path.
- `loadAccountState` keeps the session's preference as the
  `localePreference` session setting; the customer API answers it as
  `locale` on every signed-in account state, null when there is none.
- Every failure resolves to no preference, so the guest chain serves the page.
  Only an unavailable session read logs `account.locale-preference.read`.
- `pageLocalePreference`
  (`features/i18n/server/page-locale-preference.server.ts`) combines that read
  with the continuation check below into one Effect. The proxy and the action
  locale each run it once at their runtime edge.
- The proxy reads the preference only for GET/HEAD non-prefetch requests that
  pass Better Auth's `getSessionCookie` presence check, so guests never load the
  reader or touch the database. A reader that fails to load counts as no
  preference.
- With cookie caching off and `advanced.database.joins` on, one query loads the
  session, its user, and the locale.
- A stale session cookie makes Better Auth expire the cookie inside the proxy,
  so that one response doesn't refresh the locale cookie. This is accepted;
  don't add a mitigation.
- The proxy exchanges a reservation capability in its issuance locale before
  any preference redirect.

## Locale-bound continuations

Some URLs keep their issued locale, but only when they verify:

- the Pay page with a Pay state;
- the cowork, meeting-room, and office restoration pages with a Pay state of
  their kind;
- the invoice page with its order's access token.

Rules:

- Take the first raw parameter value exactly as the page reads it (no
  trimming; an empty value counts as absent). It must open with the page's own
  validator and be bound to the URL locale. A Pay state is checked for
  signature and expiry. The invoice access token is checked for signature,
  order, and locale, and has no expiry.
- Any verifier failure (failed lazy import, typed failure, or defect) applies
  the preference and logs `i18n.locale-bound-continuation.verify-failed` once,
  without the token. `preferenceApplyingTo` handles this inside its Effect.
- `findLocaleBoundContinuation` (`features/checkout/locale-bound-continuation.ts`)
  matches the URL shape without secrets. `continuesInIssuedLocale`
  (`features/checkout/backend/locale-bound-continuation.server.ts`) verifies it
  with `openPayState` and `payStateContinuesOn`, which the pages also use, or
  with `openReservationAccessToken`. `pageLocalePreference` loads the verifier
  lazily, and only when the preference would move a candidate URL.
- The Pay state fixes the language of the accepted terms, operating rules, and
  frozen accounting snapshot (the invoice language). The invoice page issues
  the invoice in the reservation's locale.
- Every other URL, including an invalid, expired, wrong-kind, or wrong-locale
  continuation, follows the preference. Server Actions apply the same rule to
  their referring page. Pages sent without a referrer (the private reservation
  pages) have no page to check, so their actions follow the preference.
  Checkout and invoice actions still validate the locale in their input.

## Email language

- Emails follow the customer's language, but a link whose target validates a
  locale is issued in the target's locale. The paid-reservation email's
  invoice link and token use the reservation's locale; its access link uses
  the email locale, because only its token and URL must agree.
- Magic-link emails read `auth.user.locale` by recipient email. An existing
  account whose preference can't be read gets no email
  (`account.magic-link.locale.read-failed`) rather than a wrong-language link.
- Reservation emails (`CustomerEmailLocaleService`) read it through the Dotypos
  customer link, and fall back to the reservation or request locale when the
  account has no preference.
