# PostHog identity and privacy boundary

This reference records the approved Workspace analytics contract, audited against
provider documentation and locked dependencies on 2026-09-11. Provider behavior
can change. The versions below are snapshot evidence, not a future guarantee.

## Account identity is a small public contract

- The account analytics boundary publishes only `pending`, `unavailable`,
  `anonymous`, or `authenticated`, plus the opaque `CustomerAccountId` for an
  authenticated account.
- Better Auth session and user details stay private to the account boundary.
- The application has one root `PostHogProvider`.
- Initialize PostHog only after analytics consent.
- Use the canonical `getPostHogAccountDistinctId` helper from
  `features/cookie-consent/utils/posthog-identity.ts`.
- Call `identify(id)` without supplied properties. A consented anonymous browser
  history may associate with the authenticated account at that call.

## Identity transition rules

- Reset the previous identity before opting PostHog into capture for a different
  account.
- Reset before opting PostHog into capture after confirmed logout, account
  deletion, or session expiry.
- Reset before opting out when analytics consent is withdrawn.
- Pause analytics while auth is `pending` or `unavailable`; do not repeat resets
  while the authority is uncertain.
- A failed logout refreshes auth authority and does not reset the identity early.
- Callers use `beginAnalyticsAccountTransition`,
  `completeAnalyticsAccountSignOut`, and `refreshAnalyticsAccountIdentity`.
- Ordinary `refreshAnalyticsAccountIdentity()` preserves an unresolved mutation
  barrier: failed logout or deletion, or a completed outcome that did not delete
  the account, uses `refreshAnalyticsAccountIdentity({ settleTransition: true })`,
  while confirmed success uses `completeAnalyticsAccountSignOut`, so
  `SessionRefresh` and focus refreshes cannot resume analytics mid-mutation.

Auth refresh reads fresh authoritative session state. Run that refresh on initial
mount, focus or visibility recovery, and cross-tab auth signals. Publish
`pending` during the refresh and `unavailable` after an authority failure.

Settled account-identity changes, including login, account switch, and expiry,
plus confirmed termination emit a same-origin notification; an ordinary
same-account refresh does not broadcast. The account lifecycle and consent
dispatcher use separate `localStorage` signals containing only random nonces,
never account or session IDs, profile data, category payloads, or timestamps, and
these signals are not analytics profiles or exports. An other-tab consent
withdrawal stops the SDK immediately, and reconsent verifies fresh auth before
enabling it; existing focus and storage-unavailable fallbacks remain.

## Event and property limits

- Disable session replay, autocapture, exception capture, heatmaps, and surveys.
  This prevents read-only profile, billing, and PIN DOM values from entering the
  integration.
- Redact URL query strings, hashes, usernames, passwords, and operational path
  identifiers.
- Apply URL, path, and query metadata cleanup to current, initial, and SDK
  session-entry variants, including session-entry campaign fields. In
  `posthog-js` 1.418.1, `session-props.js` maps these fields into
  `$session_entry_*`; disabled replay does not suppress session metadata.
- Drop malformed metadata. Remove saved UTM and click metadata.
- Do not describe network IP handling as disabled. The deprecated IP
  configuration was removed.
- New person properties exclude email, name, phone, billing, reservation IDs,
  and raw auth data.
- Existing durable server metrics retain their reservation and payment
  operational IDs where those established events require them.
- Do not add a browser-to-reservation alias or send a Dotypos customer ID.
- Set `$process_person_profile: false` on these server events.
- Consented request events use the same browser `distinct_id` and `$session_id`.
- Later webhooks cannot join a browser without approved persisted consent linkage
  and schema. No new database data export is implemented.
- The technical OTLP boundary is unchanged.
- The consent-gated server flag cookie and fixed-release strategy are unchanged.

## SDK flag-request gotcha

In `posthog-js` 1.418.1, `/flags` bypasses `before_send` and merges persisted
`$initial_person_info`, `$initial_referrer_info`, and `$initial_campaign_params`,
even when the `save_*` options are `false`.

Immediately after `init`, use the public `unregister` API for exactly those three
keys. Repeat that cleanup before re-enabling or reloading feature flags. This
local cleanup preserves the `distinct_id` and history. It does not erase remote
history or change server flag classification.

These SDK storage key names are audited for 1.418.1. Run a real SDK transport
test on every SDK upgrade. Check flag and remote-configuration requests, capture
payloads, and replay payloads.

## Browser transport and deployment contract

The checked-in browser ingest example uses a dedicated telemetry `HOSTNAME`.
Better Auth cross-subdomain cookies are disabled, so auth cookies remain
host-only.

In `posthog-js` 1.418.1, `fetch` uses native same-origin credentials, XHR leaves
`withCredentials` unset, and Beacon may include credentials. The SDK has no
public credentials-omit option. The repository has no Next upstream ingest proxy
or header-stripping path, and external proxy settings are not inspected.

Fail closed before SDK initialization when the ingest hostname matches the app
hostname, even on another port, or when the ingest URL is relative, same-origin,
non-HTTP(S), or includes userinfo. Preserve the public UI instead of throwing.
Do not silently switch to a same-host proxy. This enforces host-only auth-cookie
isolation.

The local SDK transport test models an app at `127.0.0.1` and ingest at
`localhost` on private port `3211`. It uses synthetic HTTP-only auth-cookie
negative cases across ingest headers and never contacts the real provider. This
records the checked-in configuration and runtime guard, not an audit of actual
production environment values.

An inherited read-only configuration audit dated 2026-09-11 reports that
production and preview use `https://t.workspace.deskohub.cz/` for PostHog
project `204184`. This host differs from the production
`workspace.deskohub.cz` and preview `vercel.app` app hosts, so the separate-host
guard passes for those observed values. This is inherited configuration
evidence, not a local test proving deployed behavior or proxy settings.

## Database connectors are not part of this integration

- Do not add an auth or user database connector now.
- `identify(id)` plus consented events supports browser history, funnels, and
  behavior cohorts. `identify(id)` alone does not create events.
- Raw database sync does not fix identity resolution or missing durable checkout
  attribution.
- A default Postgres sync of all columns from selected tables risks exporting
  auth PII and secrets.
- Warehouse joins run at query time. They do not store flag properties.
- No connector, warehouse sync, connector credentials, or bulk export is
  authorized.
- A future export needs an approved business purpose, property list, retention
  rule, and root policy before implementation.

## Retention and deletion

[The customer-account data retention contract](auth-data-retention-contract.md)
governs Better Auth retention and provider-first account deletion. It does not
define PostHog erasure.

Public legal content uses generic provider-settings language for analytics
retention. A completed read-only audit on 2026-09-11 (`ses_f6e3efbd7ffeQB1apvi5w3UW0l`)
observed these settings in PostHog project `204184`:
`session_recording_retention_period=30d`, `event_retention_months=84`, and
`events_retention_enforced=false`. These observed settings are not guaranteed
deletion deadlines. The 84-month value is not an enforced cap. Session replay
remains disabled.

PostHog `reset` changes local browser identity state. It does not delete remote
historical events or aliases. Historical aliases and data are not retroactively
erased or unmerged by this integration.

The project owner must decide how PostHog retention, disclosure, and historical
erasure requests are handled. This decision does not require an automatic new
workflow. It must not block the existing account-deletion path.

## Feature-flag cohorts

- Changing the PostHog `distinct_id` can change a percentage-rollout bucket.
- Keep the initial account rollout as a global off or global on decision.
- PostHog documents `ensure_experience_continuity` with
  `person_profiles: "always"`. The current integration uses
  `person_profiles: "identified_only"`, so continuity is incompatible with its
  current person classification.
- PostHog also documents continuity as incompatible with local-evaluation and
  bootstrap modes. This reference does not assign either mode to this
  integration.
- Do not enable `ensure_experience_continuity` or change person classification
  without a root decision.
- Device bucketing needs a cross-environment `device_id` contract and root
  coordination. It is not implemented.

## Verification and source snapshot

Run browser verification from `apps/deskohub-workspace`:

```sh
bun scripts/posthog-identity-browser.ts
```

The [browser verification script](../../../../apps/deskohub-workspace/scripts/posthog-identity-browser.ts)
uses local fake ingest and synthetic identities only. Its run output is the
evidence for the current implementation.

The audited lock snapshot contains `posthog-js` 1.418.1, `posthog-node` 5.49.1,
and `better-auth` 1.7.2.

Primary sources, accessed 2026-09-11:

- [PostHog identify](https://posthog.com/docs/product-analytics/identify)
- [PostHog JS reference](https://posthog.com/docs/references/posthog-js)
- [PostHog session replay privacy](https://posthog.com/docs/session-replay/privacy)
- [PostHog persons](https://posthog.com/docs/data/persons)
- [PostHog Postgres source](https://posthog.com/docs/data-warehouse/sources/postgres)
- [PostHog warehouse joins](https://posthog.com/docs/data-warehouse/join)
- [PostHog stable identity for flags](https://posthog.com/docs/feature-flags/stable-identity-for-flags)
- [Better Auth session management](https://better-auth.com/docs/concepts/session-management)
- [Pinned Better Auth session atom](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/client/session-atom.ts)
