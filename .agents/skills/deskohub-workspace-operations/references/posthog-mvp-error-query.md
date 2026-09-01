# PostHog query for the incident-loop MVP

Research date: 2026-08-28. This note defines the production-only candidate query for EU project `204184`.

## Decision

Use two `posthog-cli api` queries on every timer run:

1. Fetch Logs with severity `error` or `fatal`.
2. Fetch Error Tracking issues backed by `$exception` events.

Do not use PostHog's native Error Tracking spike endpoint for the MVP. The installed CLI does not expose it, it does not cover Logs, and it omits one-off exceptions that have not crossed PostHog's spike threshold. The timer's T3 agent should inspect the complete candidate set and decide whether the evidence is new, abnormal, actionable, or already handled.

Use a rolling seven-day lookback. Exact PostHog UUIDs and GitHub issue searches make repeated reads harmless. This avoids a cursor database and survives ordinary devbox downtime. At validation time, the production window contained 88 Error/Fatal Logs and one Error Tracking issue, well below the CLI's 1,000-row Logs limit.

## Query Error and Fatal logs

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

The Workspace logger sets `service.name` to `deskohub-workspace`, maps Effect Error and Fatal levels to lowercase `severity_text`, and copies `VERCEL_ENV` to `deployment.environment.name`. See [`workspace-service.ts`](../../../../apps/deskohub-workspace/shared/backend/observability/workspace-service.ts), [`censorship.ts`](../../../../apps/deskohub-workspace/shared/backend/logging/censorship.ts), and [`posthog-otel.ts`](../../../../apps/deskohub-workspace/shared/backend/logging/posthog-otel.ts).

PostHog matches `severityLevels` exactly against lowercase `severity_text`. The endpoint requires a date range and either a service name or a resource filter. [PostHog's query-logs contract](https://github.com/PostHog/posthog/blob/06bc099f80c670614a7195b927c93a7972ebc98f/products/logs/mcp/prompts/query-logs.md) defines those fields. [The Logs API view](https://github.com/PostHog/posthog/blob/06bc099f80c670614a7195b927c93a7972ebc98f/products/logs/backend/presentation/views/api.py#L1191-L1197) requires `logs:read`.

Each result has a stable `uuid` plus `timestamp`, `body`, `severity_text`, trace identifiers, attributes, and resource attributes. Use the UUID in the GitHub issue marker. [PostHog's result mapping](https://github.com/PostHog/posthog/blob/06bc099f80c670614a7195b927c93a7972ebc98f/products/logs/backend/logs_query_runner.py#L751-L772) defines the response.

The installed CLI has one important defect. Its schema advertises `hasMore` and `nextCursor`, but version 0.8.4 returns only `results`. If `logs-count` exceeds 1,000, split the seven-day range into smaller date ranges before calling `query-logs`. Do not assume the CLI returned every row.

## Query thrown errors

List every Error Tracking state because a resolved or suppressed issue can recur:

```bash
posthog-cli api call --json query-error-tracking-issues-list \
  '{"dateRange":{"date_from":"-7d"},"status":"all","filterTestAccounts":true,"filterGroup":[{"key":"deployment.environment.name","type":"event","operator":"exact","value":"production"}],"orderBy":"last_seen","orderDirection":"ASC","limit":100,"offset":0,"volumeResolution":7}'
```

Follow `nextOffset` while `hasMore` is true. For each candidate issue, fetch sampled occurrences:

```bash
posthog-cli api call --json query-error-tracking-issue-events \
  '{"issueId":"<issue-uuid>","dateRange":{"date_from":"-7d"},"filterTestAccounts":true,"orderDirection":"ASC","limit":20,"offset":0,"verbosity":"summary","onlyAppFrames":true}'
```

Follow the event query's offset pagination too. Its rows contain a stable event `uuid`, timestamp, and normalized exception properties such as `$exception_fingerprint`, `$exception_handled`, `$exception_level`, `$exception_list`, `$exception_types`, and `$exception_values`.

PostHog captures JavaScript errors as `$exception` events and groups them into issues by exception type, message, and stack trace. [PostHog's issues and exceptions documentation](https://github.com/PostHog/posthog.com/blob/master/contents/docs/error-tracking/issues-and-exceptions.mdx) defines this model. [The issue query serializer](https://github.com/PostHog/posthog/blob/06bc099f80c670614a7195b927c93a7972ebc98f/products/error_tracking/backend/presentation/views/query_serializers.py#L70-L140) defines the filters and page limit. [The Error Tracking API view](https://github.com/PostHog/posthog/blob/06bc099f80c670614a7195b927c93a7972ebc98f/products/error_tracking/backend/presentation/views/query.py#L53-L102) requires `error_tracking:read`.

The Workspace browser hook adds `deployment.environment.name` to every event before sending it. See [`posthog-analytics.tsx`](../../../../apps/deskohub-workspace/features/cookie-consent/components/posthog-analytics.tsx), [`posthog-event.ts`](../../../../apps/deskohub-workspace/features/cookie-consent/utils/posthog-event.ts), and [`posthog-url.ts`](../../../../apps/deskohub-workspace/features/cookie-consent/utils/posthog-url.ts).

Use the Error Tracking issue ID as the subject identity and each sampled event UUID as an occurrence identity. Put both in the GitHub issue marker. Search open and closed issues for those markers before creating work. The T3 triage agent must still decide whether a recurrence belongs on active work, is already fixed, or needs a new regression issue.

## What this captures

- Server-side `Effect.logError` and `Effect.logFatal` records exported to PostHog Logs.
- Browser uncaught errors and unhandled promise rejections captured as `$exception` events when the visitor granted analytics consent and PostHog exception autocapture is enabled.
- Any future `$exception` source that carries the Workspace production environment property. The query deliberately does not filter by SDK library.

The repository does not currently call server-side `captureException`. An escaped server exception appears in this feed only when a Workspace boundary logs it at Error or Fatal level. Browser `console.error` is not an Error Tracking exception by default.

## Live validation

The installed executable is `posthog-cli 0.8.4`. Read-only checks against project `204184` confirmed these facts without publishing log bodies or exception values:

- `deskohub-workspace` is the only current Logs service name.
- Logs carry both `preview` and `production` environment values, so the production filter is necessary.
- The Error/Fatal Logs query returns stable row UUIDs.
- The Error Tracking production filter returns grouped issues with occurrence and volume aggregates.
- The issue-event query returns event UUIDs and normalized exception properties.
- Logs and Error Tracking are separate APIs. No supported CLI query combines them.

## MVP limits

- A seven-day outage can create a gap. Increase the rolling window if that happens.
- More than 1,000 matching Logs require time-range splitting until the CLI returns its documented cursor fields.
- Error Tracking depends on browser consent and PostHog's remote exception-autocapture setting.
- PostHog evidence is input to semantic triage. UUID and fingerprint matches are only the first duplicate check.
