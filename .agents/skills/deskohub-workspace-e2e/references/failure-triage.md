# Workspace E2E failure triage

## Contents

- [Start from the trace](#start-from-the-trace)
- [Query spans in PostHog](#query-spans-in-posthog)
- [Known failure signatures](#known-failure-signatures)

Read [operations diagnostics](../../deskohub-workspace-operations/references/diagnostics.md) before you query production or provider logs, and report only the safe fields below.

## Start from the trace

1. Note the GitHub run ID and attempt. If the run failed before `bun turbo test:e2e` (target resolution, install, Neon lookup, migration, capacity validation), there are no suite spans; diagnose from that Actions step and its native step timings.
2. Query spans with `e2e.run.id = <GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>`.
3. Find the `e2e.case` whose `e2e.outcome` is `failed` or `timed_out`, then its last non-passing `e2e.step`. Only the annotated case is the root failure. After it, running cases are recorded `cancelled`, though some account-lane browser errors during shutdown surface as `failed` within about two seconds of the stop.
4. Compare the step's native duration with `e2e.timeout_ms` and read `e2e.failure.kind`. That tells you whether it failed at once or exhausted its wait.
5. Use the case and step IDs to open only the matching GitHub log section and that case's browser snapshot, HAR, and database assertion artifacts. Failure capture writes only `error.txt` when the case's browser never opened. In `network.har`, response bodies are redacted except Nexi build-failure summaries, and an entry with status `-1` and no `content.text` was still in flight when the session closed, not a lost body.
6. Form a specific hypothesis before rerunning. A rerun validates a hypothesis; a repeated failure needs a regression test and a fix.

Never dump whole spans, attribute objects, exception events, or artifact payloads. Report correlation values, span names, durations, configured timeouts, closed outcomes and failure kinds, and the minimum artifact facts.

## Query spans in PostHog

In the Workspace PostHog project, open **Traces**, filter the service name to `deskohub-workspace-e2e` and the span attribute `e2e.run.id` to the correlation value, and use native span duration, not log timestamps.

For scripted queries, call `POST https://eu.posthog.com/api/projects/204184/tracing/spans/query/` (or `.../spans/count/` for arrival counts) with a personal API key that has `tracing:read`. The public ingest token can't read traces. Bound the time range:

```json
{
  "query": {
    "kind": "TraceSpansQuery",
    "dateRange": { "date_from": "<UTC start>", "date_to": "<UTC end>" },
    "serviceNames": ["deskohub-workspace-e2e"],
    "filterGroup": {
      "type": "AND",
      "values": [
        {
          "type": "AND",
          "values": [
            {
              "key": "e2e.run.id",
              "value": "<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>",
              "operator": "exact",
              "type": "span_attribute"
            }
          ]
        }
      ]
    },
    "flatSpans": true,
    "limit": 1000
  }
}
```

The response returns span attributes such as `e2e.timeout_ms` as strings; `duration_nano` is numeric. Keep the response in memory.

## Known failure signatures

### Nexi hosted page rejects card data

The hosted driver reports `nexi_hosted_<step>_card_submission_rejected` when Nexi's `POST /fe/build/text/` fails after Continue: the fields stay disabled and Pay never appears. This is sandbox instability (typically error `GW0027`, reproducible without Workspace). Never resubmit card data. The case restarts once as described in [Nexi sandbox](nexi-sandbox.md).

### Nexi fails the authorization after 3-D Secure

The sandbox can mark the order `FAILED` with zero authorized amount after the 3DS success click. Workspace correctly settles it unpaid, and the fulfillment wait fails at once with `checkout_payment_terminal_before_fulfillment` or `checkout_fulfillment_failed_before_marker`. Confirm the provider verdict in the preview's `Nexi payment outcome verification completed` logs before you suspect Workspace. It hits a small fraction of preview orders across amounts; a slow gap between the 3DS notification and `challenge_hpp.html` is a common sign.

### Dotypos cleanup convergence times out

If a tracked reservation is still `CONFIRMED`, look for a late paid fulfillment before you blame provider latency. A case interrupted after card submission can still settle at Nexi after its finalizer cancelled the hold. Paid fulfillment never confirms a reservation Dotypos reports `CANCELLED`: it reads the reservation and its ETag, refuses `CANCELLED`, patches with `If-Match`, and records `dotypos_reservation_unfulfillable` for operator recovery. The timeout message reports only counts by status.

### Dotypos connection failures in every run

When all concurrent runs fail to connect to Dotypos, suspect the sandbox API before the code. A quick unauthenticated request that returns 401 means the API is answering.

### Cloudinary rate limit (HTTP 420)

Preview E2E shares the Cloudinary quota with production, and decorative provider data must never take a page down.

- Gallery search (`getCloudinaryImages`) uses `"use cache: remote"` so instances share results, and the Cloudinary webhook revalidates its tags. With Cache Components, a cached function that rejects during prerender fails the whole build, so `getCloudinaryImages` absorbs provider failures in its cache scope: it logs, returns no images, and uses a short `cacheLife` that retries within a minute.
- Callers treat no images as "no photos". The homepage hides its carousel, room pages render without photos, and the gallery page shows its empty state. Instant navigation accepts a resolved, visible `#hero-gallery` or no carousel, never a busy or half-rendered one.
- A missing site banner with a "Something went wrong." page is an app error-boundary failure, not a navigation race. Confirm with the deployment's Vercel request logs for `/en-US`.
- Account deletion deletes the avatar prefix through the Cloudinary Admin API after expiring the Dotypos profile. A rate limit shows as a retryable deletion with "could not expire your customer profile" copy; read the logged cause `_tag` (`Cloudinary asset prefix delete failed`), not the copy, before you blame Dotypos.
- Provider failure logs omit the HTTP code. Confirm a quota burst by querying PostHog logs for `Cloudinary search page failed` across all `service.version` values around the failure. If other previews caused it, rerun after the hourly window resets instead of changing the flow.

### WebKit Temporal runtime never hydrates

`temporal-runtime.pw.ts` in the `webkit` project fails with "The cowork form never hydrated", followed by the page diagnostics. Read them in this order:

- `Temporal is missing or incomplete` among the page errors, with the `Temporal polyfill` request failed or answered 4xx/5xx: the `<head>` loader's polyfill didn't arrive, so the browser entry threw and the server-rendered page stayed dead. WebKit reports an error status as a failed request (`Load request cancelled`) with the status beside it. Reproduced locally by aborting that route; why the runner's request failed is in the trace's network entry.
- The polyfill `still pending`: the parser is still blocked in `<head>`, so the page snapshot is empty.
- The polyfill succeeded, `Temporal=object`, and `Next.js runtime=not started`: look at the failed `App scripts` entries and the page errors instead.

The failure keeps `sanitized-trace.zip` in the test's folder of the uploaded artifact; open it with `bunx playwright show-trace`. URLs in it point at `preview.invalid`, and response bodies are dropped.

### Discount errors on a fresh preview database

A fresh preview database logs `DiscountProviderError` or `DiscountDefinitionNotFoundError` during its first run, because instant navigation resolves the Calendar sale before `checkout-setup` seeds the definition. `PromotionCodeUnavailableError` comes from the negative discount-code cases. Neither explains a checkout failure.
