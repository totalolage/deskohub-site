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

## Consent

`consent/` uses the site's categories (necessary, analytics, marketing,
preferences). Native keeps one AsyncStorage record; the web bundle reads and
writes the site's `cc_cookie` on the shared origin and rereads it when the page
regains focus. No choice yet shows the prompt; a malformed or unreadable record
counts as no consent.

## Events, identity and flags

- `analytics/events.ts` is the typed event module (screen view, sign-in
  started and completed, booking started and submitted, access PIN viewed,
  update applied). Add an event there with closed property types; never send
  free text, emails or reservation details (the event and property limits in
  the PostHog reference apply).
- Identity is `workspace-account:<accountId>`, the site's identifier, so app
  and site events join one person. It stays pending until the stored session
  is restored, resets on sign-out or account switch before the new identity
  applies, and marks test and non-production accounts internal.
- `analytics/feature-flags.ts`: `useFeatureFlagEnabled(flag, fallback)`
  returns the fallback until the identity's flags load, without consent, and
  after withdrawal. Flags reload when the identity changes. Flag definitions
  live in the Workspace (`deskohub-workspace-feature-flags` skill).
