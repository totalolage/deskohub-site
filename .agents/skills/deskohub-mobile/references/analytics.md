# Analytics

The app reports to the site's PostHog project under the site's consent and
identity rules (`deskohub-workspace-account` skill,
`references/posthog-identity-privacy.md`). That reference describes the
browser SDK; this page covers what differs in the app. Paths are relative to
`apps/deskohub-mobile/src`.

## Setup

- `analytics/analytics-root.tsx` (mounted by `app/_layout.tsx`) reads
  `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` at build time and
  tags events with the site's `deployment.environment.name` values. A missing
  or invalid key or host turns analytics off, which is the normal state of
  local and dev builds. Release builds get them from the repository variables
  `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`.
- `analytics/posthog-client.ts` creates the `posthog-react-native` client only
  after analytics consent, because the constructor already fetches remote
  config. Autocapture, surveys, session replay and exception capture are off;
  screen views come from Expo Router route patterns, without query
  parameters.
- In the web bundle, `analytics/other-posthog-sdk.ts` keeps app analytics off
  when the page already runs the site's `posthog-js`, so events are never
  captured twice.
- A refusal with no running client clears the SDK's stored state
  (`clearPostHogStoredState`: the two AsyncStorage keys posthog-react-native
  4.83.0 uses; recheck them on an SDK upgrade), so a withdrawn identity or
  queued event never returns with the next client. After a withdrawal no
  client starts until the old client's shutdown or this clearing has
  succeeded: a grant retries a failed clearing first, and if that fails too
  its analytics stays off and its events are dropped until the next refusal
  or reconnect.

## Consent

`consent/` uses the site's categories (necessary, analytics, marketing,
preferences). Native keeps one AsyncStorage record (`categories`, `decidedAt`,
`locale`); the web bundle reads and writes the site's `cc_cookie` on the
shared origin and rereads it when the page regains focus. No choice yet shows
the prompt; a malformed or unreadable record, or one without a valid
`decidedAt`, counts as no consent. `decidedAt` is kept exactly as stored,
because an account decision stored with the account's instant must be sent
back byte-identical.

### Account sync (native only)

The privacy reference's ledger section covers the server side.

- `consent/account-consent-sync.ts`: while the signed-in account's screens
  are mounted (`AccountConsentSyncRoot` in `app/(account)/_layout.tsx`), the
  app sends its choice (`analytics`, stored `decidedAt`, stored `locale` or
  the app's) or `null` to `syncAnalyticsConsent`. Triggers: the account
  registry mounting (session restore, sign-in, which also mirrors a choice
  made while signed out), a customer answer or the first storage read, and
  every return to the foreground (`platform/app-foreground.ts`). A newer
  sync interrupts an older one.
- It applies `withdraw` only over a choice that accepted analytics and
  `grant` only where there was no choice (analytics on, other optional
  categories off), both dated at the answered instant, and only when the
  device's choice and the signed-in account are unchanged since the request.
  A failure changes nothing and shows nothing; the next trigger retries.
- The hold (`consent/account-consent-check.ts`): a signed-in account is held
  until its check settles, from session start and again from each foreground
  `AppState` event (set synchronously, before the SDK's own flush). A check
  covers only the device choice it settled for, and `holds` reads that choice
  itself, so a new choice (the prompt's answer, a storage read) is held from
  the moment it is stored, whatever order consent subscribers run in, until
  its own sync settles. An account decision the device takes
  (`takeAccountDecision`: a sync's answer or a Legal save) settles the check
  for the stored answer. While held the controller starts no client,
  identifies nothing and keeps captures and screens in its outbox, and an
  identified client's network is paused (`holdNetwork`), so its queued events
  and its app-state flushes wait. A withdrawal applied meanwhile discards all
  of it; a settled or failed (or timed-out) sync releases it. The consent
  prompt waits while the stored session is restored and until the rendered
  account's own first check settles (`useConsentPromptWaits`), so a new
  account never sees it a frame early. Not covered: requests already in
  flight, the SDK's flush when the app leaves the foreground, and
  `$feature_flag_called` events `getFeatureFlag` queues while a foreground
  hold pauses an identified client (they wait with the network and a
  withdrawal drops them).
- The web bundle doesn't sync, hold or gate the prompt: its consent is the
  site's cookie, which the site mirrors at sign-in and on each signed-in page
  and withdraws there.

### Analytics preference

The Legal screen (`account/legal/analytics-preference.ts`) shows the
signed-in account's preference (`getAnalyticsPreference`) whatever its
profile's state, as the site does (only marketing consent needs a linked
profile), and saves it
(`saveAnalyticsPreference`, app locale). The saved `{granted, decidedAt}`
becomes this device's choice in either direction, unless the choice or the
account changed during the save (the web preference row's rule). While the
screen is mounted it reads the preference again on each return to the
foreground (`followAnalyticsPreference`), so a withdrawal made on the site
shows there as the account sync applies it. A failed read shows
"unavailable", never "off".

## Events, identity and flags

- `analytics/events.ts` is the typed event module (screen view, sign-in
  started and completed, booking started and submitted, access PIN viewed,
  update applied). Add an event there with closed property types; never send
  free text, emails or reservation details (the event and property limits in
  the PostHog reference apply).
- Each event has a production caller, and `analytics/events.test.ts` fails
  for one without. Native email sign-in records "sign-in started" (`link`)
  when the auth session opens, since the web page sends the email; the
  passkey option records `passkey` when its ceremony starts. "sign-in
  completed" takes the method the web page names on the handoff
  (`auth/auth-callback.ts`): `link`, `code` or `passkey`, or `continue` when
  the customer taps "Continue as <account>" and the page hands over its
  existing session, so a re-sign-in without a new email still completes.
  A handoff with no method, from an older web bundle, records nothing.
  The start's method is the entry point and the completion's is the method
  used, so compare methods on completions, not across the two steps.
  "access PIN viewed" fires per focus of the access screen. "update applied"
  (`updates/applied-update.ts`) fires on the first launch of a downloaded
  update, compared with the update id the previous launch stored; embedded
  launches (rollback, emergency launch, new APK) never record it.
- Identity is `workspace-account:<accountId>`, the site's identifier, so app
  and site events join one person. It stays pending until the stored session
  is restored (and, on native, until the account sync's hold releases it),
  resets on sign-out or account switch before the new identity
  applies, and marks test and non-production accounts internal.
- `analytics/feature-flags.ts`: `useFeatureFlagEnabled(flag, fallback)`
  returns the fallback until the identity's flags load, without consent, and
  after withdrawal. In production, flags reload when the identity changes;
  other environments never request flags (`allowsRemoteFeatureFlags`), so
  reads keep the fallback. Flag definitions
  live in the Workspace (`deskohub-workspace-feature-flags` skill).
