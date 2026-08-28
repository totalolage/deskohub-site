# Custom PostHog intake for the devbox agent loop

Research date: 2026-08-28. This note covers project 204184 on PostHog EU. It deliberately excludes PostHog Self-driving Signals, reports, and agents. No production payloads or credentials were read.

## Decision

Poll PostHog directly from the devbox. Do not use Slack as the machine trigger.

The accepted v1 boundary is production-only:

- new Error Tracking issues
- reopened Error Tracking issues
- Error Tracking spike events
- Logs alerts entering `firing` or `broken`

Run one systemd timer every five minutes. It calls the compact Error Tracking issue query, spike event list, Logs alert list, and each allowlisted alert's event history. It writes a bounded normalized incident only after an atomic local claim. It needs no inbound listener, webhook, public URL, port forwarding, Slack app, or persistent socket.

The user accepted one known gap: a resolved issue that reopens and resolves again entirely between polls can be missed. Do not add Slack or a deprecated analytics-event cursor to close that gap in v1.

## Error Tracking transition gap

PostHog emits one internal `$error_tracking_issue_created` event for a new issue and one `$error_tracking_issue_reopened` event for each resolved-to-active transition. Each lifecycle event has a unique notification UUID, and the issue UUID is its `distinct_id`. ([created activity](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/temporal/lifecycle/issue_created/activities.py), [reopened activity](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/temporal/lifecycle/issue_reopened/activities.py), [event producer](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/temporal/lifecycle/side_effects.py))

The dedicated Error Tracking read API does not expose that lifecycle stream. Its compact issue query returns current `status`, `first_seen`, and `last_seen`, with offset pagination. It does not return `state_updated_at` or a reopen occurrence ID. A direct poller can notice an issue whose locally remembered state changed from resolved to active, but it can miss a resolve, reopen, and resolve cycle that happens between polls. The checked-in client confirms this response shape. ([generated client](../../../../packages/posthog/src/generated/effect.gen.ts), [query serializer](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/presentation/views/query_serializers.py))

The generic `GET /events/` API can read the lifecycle events, but PostHog marks that endpoint effectively deprecated and says not to use it for multi-page exports. Building the loop's cursor on it would make an explicitly discouraged endpoint a critical dependency. ([event API source](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/posthog/api/event.py#L191-L198)) The direct poller therefore infers created and reopened candidates from compact issue state and its local observations.

This is not an exact transition stream. The missed rapid-cycle case is documented and accepted. Alert when the collector cannot complete a PostHog poll for 15 minutes. Never advance discovery state after a failed or partial page.

## PostHog corroboration endpoints

Use `https://eu.posthog.com` for all private API calls. Prefer a project secret API key if project 204184 has that beta feature. Otherwise use a dedicated service user's personal API key. PostHog documents project secret keys as project-scoped server-to-server credentials and personal keys as the normal choice for scripts. ([API authentication](https://posthog.com/docs/api#authentication), [personal key scopes](https://posthog.com/docs/api/personal-api-keys))

Grant only:

- `error_tracking:read`
- `logs:read`

Do not grant `query:read`, `task:read`, or write scopes for intake v1.

### Created and reopened issues

Call:

```text
POST /api/projects/204184/error_tracking/query/issues/
POST /api/projects/204184/error_tracking/query/issue/
```

On first start, set the discovery watermark to now. Do not backfill old issues into agent jobs.

For later polls, query with:

- a status refresh through `query/issue/` for every locally remembered active production issue
- an explicit date range starting 15 minutes before the last successful watermark
- `status: "active"`
- `filterTestAccounts: true`
- the project's canonical production-environment filter
- `orderBy: "last_seen"`
- `orderDirection: "DESC"`
- `limit: 100`, paging with `offset` until all remaining rows are older than the overlap

Refresh known active issues before discovering recent active rows. This records a normal active-to-resolved change even when the issue emits no new exception after a human resolves it. Bound the active roster at 50. If the production filter yields more, stop launching work and ask a human to reduce noise; do not silently sample status transitions.

Classify an active row as:

- `created` when `first_seen` is after the prior successful watermark
- `reopened` when the local previous status was non-active
- `reopened_or_rediscovered` when the issue was unseen locally, `first_seen` is older, and `last_seen` is after the prior watermark

Do not launch again while the same issue remains active. Persist every refreshed state so a later non-active-to-active change creates a new occurrence. Use `created:<issue_uuid>` for the first occurrence. For a reopened occurrence, atomically claim a digest of `reopened:<issue_uuid>:<last_seen_at_detection>`. `last_seen` is captured once at classification time; later exceptions do not rename the claim.

The list accepts status, date range, production property filters, ordering, limit, and offset. The detail response can supply current status, impact counts, top application frame, and release metadata without fetching sampled exception events. Both endpoints require `error_tracking:read`. ([OpenAPI](https://eu.posthog.com/api/schema/swagger-ui/), [query view](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/presentation/views/query.py), [generated client](../../../../packages/posthog/src/generated/effect.gen.ts))

Issue UUID is the subject key, not a permanent occurrence key. The same issue can reopen more than once. Construct links from validated issue IDs. Fingerprint links survive merges, but the compact response does not expose a fingerprint, so v1 must not invent one. ([fingerprint permalink source](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/logic/__init__.py#L131-L155))

### Spike events

Call:

```text
GET /api/projects/204184/error_tracking/spike_events/
```

Each result has a spike event UUID, issue UUID, `detected_at`, computed baseline, and current bucket count. PostHog persists a spike with the lifecycle notification UUID through `get_or_create`, so the spike UUID is the native occurrence and dedupe key. A recurrence gets another UUID. ([spike persistence](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/temporal/lifecycle/issue_spiking/activities.py), [spike contract](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/facade/contracts.py#L132-L145))

The current server source accepts `issue_ids`, `date_from`, `date_to`, `order_by`, `limit`, and `offset`, defaulting to newest `detected_at`. It retains spike rows for 30 days. The checked-in generated client exposes only `limit` and `offset`, so implementation must either stay within that generated contract or regenerate it from the live schema before using the newer filters. ([view](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/presentation/views/spike_events.py), [ordering](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/logic/__init__.py#L249-L265), [30-day cleanup](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/error_tracking/backend/temporal/spike_event_cleanup/types.py))

Page newest first with one-page overlap until reaching a previously claimed UUID or a `detected_at` older than the watermark overlap. Claim the spike UUID before enrichment. Re-read the issue through the compact query with the production filter; reject a spike that cannot be tied to production evidence.

### Log alert transitions

Call:

```text
GET /api/projects/204184/logs/alerts/
GET /api/projects/204184/logs/alerts/{alert_uuid}/events/
```

The alert event endpoint returns UUID, timestamp, kind, state before and after, threshold breach, result count, error message, and query duration. It orders newest first and filters quiet check rows that have no state change or error. Trigger T3 Code only for a corroborated transition whose `state_after` is `firing` or `broken`. Use the PostHog alert event UUID as the native occurrence key. A later resolved-to-firing transition gets a new event UUID. ([event endpoint](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/logs/backend/presentation/views/alerts_api.py#L1079-L1112), [generated event shape](../../../../packages/posthog/src/generated/effect.gen.ts))

There is no timestamp cursor on this endpoint. Page newest first until reaching a previously claimed event UUID, with at least one-page overlap. Never advance the local watermark after a partial page or decode failure. PostHog retains forensic and transition rows for 90 days, while it prunes quiet rows separately. ([retention source](https://github.com/PostHog/posthog/blob/6c4717b6ccc5e17981609ab300b0575fe16d8092/products/logs/backend/models.py#L285-L338))

The live endpoint accepts an optional `kind`, while the checked-in generated client exposes only `limit` and `offset`. Filtering locally is safe because the endpoint already removes quiet rows. Do not bypass the generated contract for this optional optimization.

## Polling and failure rules

Use a five-minute systemd timer. Logs alerts themselves run every five minutes, and PR preparation does not need sub-minute pickup.

On each poll:

1. Fetch and fully decode all Error Tracking issue pages in the watermark overlap.
2. Fetch and fully decode spike pages until reaching a claimed UUID or the old side of the overlap.
3. List Logs alerts, restrict them to the configured production alert UUID allowlist, and fetch each event history to the same stopping condition.
4. Sort new occurrences by source timestamp and atomically claim each occurrence before enrichment.
5. Re-read compact issue or alert state. Reject anything outside production or no longer matching its trigger state.
6. Write only the normalized occurrence, then advance the successful watermark.

Use a 15-minute overlap for normal polling. After an outage, page from the last successful watermark subject to PostHog's source retention. Spike events remain available for 30 days and Logs transition rows for 90 days. Issue transition inference has no equivalent retained occurrence stream.

Treat `401` and `403` as configuration incidents. Retry `429` and `5xx` with bounded exponential backoff and jitter. Treat schema failures as fail-closed. A quiet project is not a failure signal; a poll that has not completed successfully for 15 minutes is.

## Normalized incident packet

Everything received from PostHog is untrusted data. Build a new object from an allowlist. Do not redact a copied raw payload in place.

Allow:

- provider kind and provider occurrence UUID when available
- project ID fixed to `204184`
- issue or alert UUID and a locally constructed PostHog URL
- current issue status and severity
- issue name and description after secret/PII scrubbing, each capped at 300 characters
- first and last seen timestamps
- occurrence, user, and session counts only as aggregate numbers
- library and source file, each capped at 300 characters
- one top application frame with function, file, line, and column
- release version, commit, and branch, each capped at 200 characters
- spike baseline and current bucket count
- log alert state before and after, result count, threshold operator/count/window, capped service names, and enum severity levels

Drop:

- request and response bodies, headers, cookies, authorization data, query strings, and form data
- `exception_props`, arbitrary event properties, person records, distinct IDs, email addresses, names, IP addresses, and database rows
- session replay data, session IDs, raw URLs, navigation history, and browser storage
- captured code variables and SDK locals
- full stack traces and raw log lines
- raw log alert filters and error messages

The compact issue endpoint is intentionally enough for the first agent pass. If it cannot reproduce the problem from this packet and the repository, mark the job `needs_human`. Do not let an unattended worker fetch raw sampled exception events or logs.

Cap the normalized packet at 8 KiB. Validate UUIDs, ISO timestamps, numeric bounds, state enums, and maximum array lengths before writing it. Never derive a path, branch, shell argument, PR title, or prompt instruction from alert text.

## Dedupe and recurrence policy

Keep two identities:

- Occurrence key: the created/reopened claim described above, a spike UUID, or a Logs alert event UUID.
- Subject key: Error Tracking issue UUID or Logs alert UUID.

The occurrence key prevents retries from starting the same job twice. The subject key prevents concurrent duplicate fixes. If a subject already has a working job or open PR, attach the new occurrence to it and do not start another T3 Code task. After that job or PR reaches a terminal state, a new occurrence can start a new job. This handles repeated reopens, later spikes, and a log alert that fires again after resolving.

Do not collapse all recurrences forever by issue UUID or alert UUID. That would hide regressions after a fix shipped.

## Optional Slack alternative

Slack can close the accepted rapid-reopen gap because PostHog officially sends created-or-reopened notifications there. An internal Slack reader can poll `conversations.history` with `groups:history`, use `(channel_id, message.ts)` as a delivery key, and then corroborate the message through PostHog. Slack documents time and cursor pagination and retains Tier 3 limits for internal customer-built apps. ([Error Tracking alerts](https://posthog.com/docs/error-tracking/alerts), [Slack history API](https://docs.slack.dev/reference/methods/conversations.history/))

Do not add it in v1. It adds an OAuth credential, channel retention policy, destination delivery monitoring, and a Block Kit parser. Reconsider only if missed rapid reopen transitions become a measured problem.

## Rejected transports

- PostHog webhook destination requires an inbound endpoint and violates the network constraint.
- Slack polling adds an intermediary and is unnecessary under the accepted transition gap.
- Slack Socket Mode adds a long-running process and history backfill.
- The deprecated PostHog Events API and generic analytics `/query` API would turn export endpoints into a queue. The dedicated compact Error Tracking query is still used.
- Polling current issue state cannot prove every reopen occurrence; this limitation is accepted for v1.
- A managed queue is unnecessary for one devbox. Add one only if source retention becomes a measured problem or multiple machines need competing-consumer claims.

## API gaps to resolve before implementation

1. Identify and encode the canonical production-environment property filter for Error Tracking without reading or printing production payloads.
2. Record the production Logs alert UUID allowlist. Do not infer production scope from an alert name.
3. Regenerate the checked-in PostHog client if implementation needs live spike filters or log-event `kind`; otherwise use only the parameters already generated.
4. Use synthetic issues, spike fixtures, and log alert transitions to prove cursor overlap, duplicate suppression, and fail-closed schema behavior before starting T3 Code.
5. Simulate a PostHog `401`, `429`, partial page, and decode failure. None may advance the watermark or start a task.

These are setup tests, not reasons to add another service.
