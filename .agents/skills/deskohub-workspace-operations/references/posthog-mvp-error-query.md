# PostHog production error query

Read production candidates for EU project `204184` over a rolling seven-day window. Exact PostHog IDs in GitHub issue markers make repeated reads harmless, so no cursor is needed and missed passes self-heal. Logs and Error Tracking are separate APIs; run both.

Don't use PostHog's Error Tracking spike endpoint. `posthog-cli` doesn't expose it, it doesn't cover Logs, and it omits one-off exceptions below the spike threshold.

## Query error and fatal logs

Count the rows first:

```bash
posthog-cli api call --json logs-count \
  '{"query":{"dateRange":{"date_from":"-7d"},"severityLevels":["error","fatal"],"serviceNames":["deskohub-workspace"],"filterGroup":[{"key":"deployment.environment.name","type":"log_resource_attribute","operator":"exact","value":"production"}]}}'
```

When the count is at most 1,000, fetch the rows:

```bash
posthog-cli api call --json query-logs \
  '{"query":{"dateRange":{"date_from":"-7d"},"severityLevels":["error","fatal"],"serviceNames":["deskohub-workspace"],"filterGroup":[{"key":"deployment.environment.name","type":"log_resource_attribute","operator":"exact","value":"production"}],"orderBy":"earliest","limit":1000,"excludeAttributes":false}}'
```

`posthog-cli` 0.8.4 advertises `hasMore` and `nextCursor` but returns only `results`. When `logs-count` exceeds 1,000, split the date range until each `query-logs` call is complete.

Keep the production filter: Logs carry both `preview` and `production` values in `deployment.environment.name`. `severityLevels` matches lowercase `severity_text` exactly. The Workspace logger sets these in [`telemetry-sinks.ts`](../../../../apps/deskohub-workspace/shared/backend/observability/telemetry-sinks.ts) and [`censorship.ts`](../../../../apps/deskohub-workspace/shared/backend/logging/censorship.ts). Each row's stable `uuid` goes in the GitHub issue marker.

## Query thrown errors

List every Error Tracking status, because a resolved or suppressed issue can recur:

```bash
posthog-cli api call --json query-error-tracking-issues-list \
  '{"dateRange":{"date_from":"-7d"},"status":"all","filterTestAccounts":true,"filterGroup":[{"key":"deployment.environment.name","type":"event","operator":"exact","value":"production"}],"orderBy":"last_seen","orderDirection":"ASC","limit":100,"offset":0,"volumeResolution":7}'
```

Follow `nextOffset` while `hasMore` is true. For each candidate issue, fetch sampled occurrences and follow their offset pagination too:

```bash
posthog-cli api call --json query-error-tracking-issue-events \
  '{"issueId":"<issue-uuid>","dateRange":{"date_from":"-7d"},"filterTestAccounts":true,"orderDirection":"ASC","limit":20,"offset":0,"verbosity":"summary","onlyAppFrames":true}'
```

The Error Tracking issue ID identifies the subject, and each sampled event `uuid` identifies an occurrence. Event rows carry `$exception_fingerprint`, `$exception_types`, `$exception_values`, and related normalized properties.

## Coverage limits

- Logs cover server-side `Effect.logError` and `Effect.logFatal`. Workspace doesn't call server-side `captureException`, so an escaped server exception appears only when a boundary logs it at error or fatal level.
- Error Tracking covers browser uncaught errors and unhandled rejections as `$exception` events, only after analytics consent and while PostHog exception autocapture is on. The browser adds `deployment.environment.name` in [`browser-analytics-session.ts`](../../../../apps/deskohub-workspace/features/cookie-consent/browser-analytics-session.ts). Browser `console.error` isn't captured.
- An outage longer than seven days leaves a gap. Widen the window after one.
- ID and fingerprint matches are only the first duplicate check. Semantic triage decides.
