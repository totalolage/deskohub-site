# Account analytics consent

The account keeps its own record of the visitor's analytics choice, so the
server can read a booker's decision without a browser. The cookie banner
stays the place where the choice is made; the account copies it.

## Glossary

- **Consent decision**: one row of the account's analytics consent ledger
  (`account_analytics_consent_decisions`): `grant` or `withdraw`, the hash of
  the privacy notice it was given under, the notice's locale, when it was
  made (`decided_at`), and where it came from (`source`).
- **Current decision**: the account's decision with the latest `decided_at`;
  ties go to the one recorded last. A later grant restores a withdrawn
  consent. An account without decisions has none.
- **Mirror**: copying the device's banner choice (the `cc_cookie` the browser
  sends) into the ledger, dated at the cookie's own `lastConsentTimestamp`.
- **Source**: `banner` (a save in the banner while signed in),
  `sign_in_mirror`, `hydration_mirror` (a signed-in session used on a device:
  page hydration or an authenticated action that reads the cookie, such as
  Pay-state preparation), `backfill` (the one-off seeding of earlier
  consent), and `preference` (account preferences).
- **Silent grant**: applying the account's grant to a signed-in device that
  holds no consent cookie at all, when the current decision is a grant under
  the current privacy notice of the decision's locale: the cookie accepts
  analytics and declines every other optional category, and no banner shows. A device holding a
  cookie from an earlier banner revision gets the banner instead.
- **Person-linked**: a reservation or payment lifecycle event captured under
  the author's account person (`workspace-account:<accountId>`) because the
  author's current decision was a grant when it was captured.
- **Reservation-keyed**: a lifecycle event captured under the reservation ID
  with no person: the author's current decision was a withdrawal or none, or
  the ledger couldn't be read.

## Invariants

- The ledger is append-only. Nothing updates or deletes a decision except
  account deletion: rows reference `auth.user` with `ON DELETE CASCADE`.
- A decision records `getLegalDocumentVersion(locale, "privacy-policy")` at
  the moment it is written: the notice current when the decision was recorded.
  For a mirror of an older cookie that need not be the notice the visitor saw
  when choosing. The banner revision derives from the privacy notice and
  cookie policy versions, and the server treats a cookie saved under an older
  revision as no choice, so a mirror records nothing from it. A mirror uses
  the banner language the cookie holds (`languageCode`) when it is a site
  locale, else the request's locale.
- A mirror is appended only when the account has no decision at that
  instant or later, so a stale cookie never overrides a newer decision. A
  cookie without a valid timestamp, or dated in the future (a device clock
  ahead), seeds only an empty ledger, dated now: dating a future cookie now
  would let each replay of it outrank later decisions.
- Every write takes the account's `analyticsConsentLedger` lock
  (`WorkspaceLocks`, rank 25, above the account lock that Pay-state
  preparation holds) and reads its instant after the lock, so a mirror's
  check sees every decision recorded before it.
- `visitorConsent`'s cross-tab overwrite (`CookieConsent.setCookieData`)
  rewrites the categories without a new `lastConsentTimestamp`. While signed
  in, the tab records that change as a banner save; a signed-out change made
  that way keeps the earlier save's timestamp, so a later mirror takes it only
  while that timestamp is newer than the account's latest decision.
- A banner save while signed in is a decision made now, not a mirror; it
  never waits on the ordering rule.
- A device without a well-formed consent cookie records nothing; an
  unreadable cookie is never read as a withdrawal.
- Recording never changes what the visitor sees and never blocks sign-in or
  checkout: failures are logged and dropped.
- A grant keeps linking lifecycle events even under an older notice hash,
  until the account answers again; only a current-notice grant gives a silent
  grant. A decision records no cookie policy version, so a grant given before
  a cookie-policy-only change still gives a new device a silent grant. The
  PostHog side is in the `deskohub-workspace-account` skill's PostHog
  identity and privacy reference.

Code: `features/legal/backend/analytics-consent-ledger.ts` (ledger),
`features/legal/backend/analytics-consent-mirror.ts` (cookie to decision),
mirror points in `features/account/backend/auth/auth-server.ts` (session
create hook), `features/legal/components/account-analytics-consent-mirror.tsx`
with the `recordDeviceAnalyticsConsent` action (hydration and banner saves),
and `features/reservation/actions/prepare-pay-state.ts` (bookings).
