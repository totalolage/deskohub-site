# Production diagnostics

Report counts, IDs, statuses, and error codes. Never print or quote secrets, tokens, customer access codes, or raw production payloads.

## Check log freshness first

Before you diagnose from PostHog Logs, confirm that service `deskohub-workspace` has recent entries, for example with a `logs-count` over `-24h` without the severity filter. Ingestion can stop, and an empty window then means missing evidence, not a healthy system. [posthog-mvp-error-query.md](posthog-mvp-error-query.md) has the query shapes.

## Log through the censored pipeline

- Use `Effect.log*` for Workspace diagnostics, not `console.*`.
- Keep useful log annotations. `apps/deskohub-workspace/shared/backend/logging/censorship.ts` censors and redacts all Workspace and Dotypos application logs, so strip annotations locally only for a new uncensored sink.
- Attach handled failures to their error logs. Censorship keeps recursive cause types, safe classification fields, and stack frames for source-map attribution. It redacts dynamic stack message lines, sensitive database diagnostics, and marked query parameters.
- The span exporter doesn't censor span names. `createWorkspaceSpanRedactors` in [`span-redaction.ts`](../../../../apps/deskohub-workspace/shared/backend/observability/span-redaction.ts) scrubs credential-bearing URL segments such as Cloudinary `s--…--` signatures. List its processors first in every Workspace tracer provider.
- Keep access-code-like keys globally censored. Customer access codes have reached PostHog annotations before.

## Bound sensitive inspection

- Don't add, enable, fetch, or quote raw Dotypos request and response logging without explicit redaction. It carries Authorization headers, refresh tokens, bearer tokens, and token response bodies.
- Don't fetch or quote full Cloudinary search payloads. Report the result count, public IDs, status, and error code.
- Never fetch, print, or quote a signed Cloudinary tag list URL. Its `s--…--` segment derives from the API secret. For the gallery data source and Admin API quota, load `$deskohub-repository`.
- Never print or quote raw `posthog-cli` output. It can carry the project API URL, response bodies, and presigned S3 URLs. `build:source-maps` logs a fixed-vocabulary summary of each failed attempt from `describeSourceMapUploadFailure` in `apps/deskohub-workspace/scripts/source-map-upload-failure.ts`. When a failure shows up as unrecognised, extend those vocabularies, and recheck them after a CLI upgrade.
- Run ad-hoc Workspace status or service scripts only when you need them. They can print raw reservation annotations, including customer access codes.

## Verify integration identity first

When an exact Cloudinary public ID returns 404, verify the full Cloudinary account tuple before you change image-rendering code. Sibling app environment files can target another product environment.

## Retry database reads at the repository boundary

For Workspace database read instability, wrap idempotent reads in `retryDatabaseRead` from `apps/deskohub-workspace/db/retry-database-read.ts`. State-changing operations need their own idempotency boundary before they retry.

Batch workflows that issue concurrent database reads need a numeric concurrency limit that leaves headroom in the process pool.

## Attribute runtime timeouts carefully

When successful responses keep running until the hosting timeout, check post-response logging and telemetry flushes as well as provider durations.

A provider timeout can be an instance that was suspended mid-run, not a slow provider. The signs: the run's start log carries an `observed_timestamp` minutes or hours after its `timestamp`, and the retry warning and the final timeout land milliseconds apart instead of one request timeout apart. Look for work that no response awaited. Compare an isolated preview change against a stable baseline on equivalent traffic. Don't credit a caching change when database or provider behavior changed in the same window.
