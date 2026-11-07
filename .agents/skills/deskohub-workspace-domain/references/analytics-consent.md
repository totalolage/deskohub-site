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

## Invariants

- The ledger is append-only. Nothing updates or deletes a decision except
  account deletion: rows reference `auth.user` with `ON DELETE CASCADE`.
- A decision records `getLegalDocumentVersion(locale, "privacy-policy")` at
  the moment it is written: the notice current when the decision was
  recorded. For a mirror of an older cookie that need not be the notice the
  visitor saw when choosing; the cookie carries no notice version until the
  banner revision is bound to the notice. A mirror uses the banner language
  the cookie holds (`languageCode`) when it is a site locale, else the
  request's locale.
- A mirror is appended only when the account has no decision at that
  instant or later, so a stale cookie never overrides a newer decision. A
  cookie without a valid timestamp, or dated in the future (a device clock
  ahead), seeds only an empty ledger, dated now: dating a future cookie now
  would let each replay of it outrank later decisions.
- The check and the insert are one statement without a lock. Concurrent
  writers can both land; the latest `decided_at` still decides, so only an
  undated seed racing another device's decision in the same instant can
  order the two by arrival.
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

Code: `features/legal/backend/analytics-consent-ledger.ts` (ledger),
`features/legal/backend/analytics-consent-mirror.ts` (cookie to decision),
mirror points in `features/account/backend/auth/auth-server.ts` (session
create hook), `features/legal/components/account-analytics-consent-mirror.tsx`
with the `recordDeviceAnalyticsConsent` action (hydration and banner saves),
and `features/reservation/actions/prepare-pay-state.ts` (bookings).
