# PostHog capabilities for an agent-driven bug-fix loop

> **Status: alternative rejected. Do not implement the recommendation below.** The developer chose a custom devbox loop controlled through T3 Code, with direct raw PostHog polling and GitHub Issues as the task surface. PostHog Self-driving, Signals reports, and cloud sandbox execution are out of scope. See [the selected intake](posthog-custom-agent-intake.md), [the current control plane](github-incident-agent-loop.md), and [supported T3 control](t3code-agent-control.md). The remaining content is capability research only.

Research date: 2026-08-28. Sources are PostHog's current official documentation, OpenAPI schema, and source repositories. This note describes capabilities only; it does not contain production payloads or credentials.

## Recommendation

Start with **PostHog Self-driving**, not a Slack-to-cron bridge. PostHog now provides the loop being proposed: signal sources watch error tracking and logs, the inbox deduplicates and groups related evidence into reports, research decides whether a code change is actionable, and an implementation agent works in a cloud sandbox and opens a pull request for human review. Setup is `npx @posthog/wizard self-driving`; manual setup can enable selected signal sources and scouts and connect GitHub. The product is currently open beta. ([overview](https://posthog.com/docs/self-driving), [setup](https://posthog.com/docs/self-driving/setup), [implementation](https://posthog.com/docs/self-driving/inbox/implementation))

This path requires no inbound connection to the devbox because it does not use the devbox: PostHog clones the selected GitHub repository into its own sandbox, creates a branch, runs configured local tests, pushes, and opens a PR. The documented boundary is human merge; nothing ships automatically. ([implementation](https://posthog.com/docs/self-driving/inbox/implementation), [FAQ](https://posthog.com/docs/self-driving/faq))

If execution **must** happen on the devbox, use a small outbound-only timer that polls PostHog's inbox reports API. Do not poll Slack. The inbox has already performed the valuable work: correlating error tracking, log alerts, session replay, and other evidence; deduplicating it; researching it; and marking it actionable. The current OpenAPI schema exposes `GET /api/projects/{project_id}/signals/reports/` with filters for `source_product`, `status`, priority, timestamps/order, and whether an implementation PR exists, protected by `task:read`. ([signal sources](https://posthog.com/docs/self-driving/inbox/sources), [OpenAPI schema](https://eu.posthog.com/api/schema/swagger-ui/))

Minimal local shape:

1. A systemd user timer or cron job polls actionable inbox reports every five minutes over outbound HTTPS.
2. A local SQLite ledger claims each report UUID once with a unique constraint before launching an agent; store the resulting branch/PR URL and terminal status there.
3. The agent fetches only the bounded report and evidence needed, works in a fresh worktree, runs repository checks, pushes a branch, opens a draft PR, and follows CI/review until ready.
4. Keep merge human-only initially.

The SQLite claim ledger is a local design inference, not a PostHog feature. It is needed because polling and process restarts otherwise permit duplicate agent runs.

## What can trigger the loop

### Error tracking

- PostHog captures exceptions as `$exception` events and fingerprints them into issues. Automatic grouping uses exception type, message, and stack trace; a client fingerprint or configured grouping rule takes precedence. That issue UUID is a better deduplication key than an individual event UUID. ([issues and exceptions](https://posthog.com/docs/error-tracking/issues-and-exceptions))
- Native error-tracking alerts can fire when an issue is created or reopened, can filter on issue properties/assignment, and can deliver to Slack, Discord, Teams, or an HTTP webhook. Spike alerts cover an existing issue whose volume rises above its historical baseline. ([error tracking alerts](https://posthog.com/docs/error-tracking/alerts))
- The Self-driving error-tracking source covers new exceptions, reopened issues, and volume spikes. Related signals are deduplicated and grouped with other evidence before research begins. ([signal sources](https://posthog.com/docs/self-driving/inbox/sources))
- For a direct local poller, the private API exposes `POST .../error_tracking/query/issues/` for typed compact issue lists, `POST .../query/issue/` for issue details, and `POST .../query/issue_events/` for sampled events and stack/browser/SDK/session context, all under `error_tracking:read`. The older paginated `GET .../error_tracking/issues/` endpoint also exists. ([OpenAPI schema](https://eu.posthog.com/api/schema/swagger-ui/))

### Logs

- Log alerts evaluate every five minutes. They filter by severity, service, and attributes and support thresholds over 5–60 minute windows. Noise controls include M-of-N consecutive checks and a notification cooldown. ([log alerts](https://posthog.com/docs/logs/alerts))
- When a log alert enters `Firing` or `Broken`, PostHog automatically emits a Self-driving signal containing the alert definition, observed count, filters, and a link to matching logs. `Resolving` and `Errored` do not emit signals. This makes the inbox API preferable to scraping or separately querying raw logs. ([log alerts](https://posthog.com/docs/logs/alerts))
- The OpenAPI schema also exposes log-alert CRUD, simulation, alert-event history, and query endpoints if direct polling is needed. ([OpenAPI schema](https://eu.posthog.com/api/schema/swagger-ui/))

### Insight alerts and destinations

- Trends, funnels, and HogQL insights can use threshold or anomaly alerts; current notification destinations include email, Slack, Discord, Teams, and webhooks. Real-time insight alerts exist on Scale/Enterprise; otherwise cadences include 15 minutes through monthly. ([alerts](https://posthog.com/docs/alerts))
- A real-time Slack destination can match `$exception` or any event and send a templated message immediately or on a schedule. This is useful for humans, but the message is a projection of the event rather than a durable work queue. ([Slack destination](https://posthog.com/docs/cdp/destinations/slack))
- A webhook destination POSTs event data to a configured URL and supports event filters and payload templates. It requires an inbound HTTP endpoint, so it conflicts with the no-port-forwarding/no-inbound-network constraint. ([webhook destination](https://posthog.com/docs/cdp/destinations/webhook))
- PostHog Workflows is primarily a no-code customer messaging/automation product built from triggers, delays, audience splits, message sends, and PostHog actions. It can dispatch to destinations, but it adds no advantage over Self-driving signal sources for engineering incident intake. ([Workflows](https://posthog.com/docs/workflows))

## Slack's appropriate role

Slack is optional notification and steering, not the transport between PostHog and a local agent.

- Self-driving setup can post each new report to `#posthog-inbox`. ([setup](https://posthog.com/docs/self-driving/setup))
- A human can mention `@PostHog` with a task; PostHog then plans in a sandbox, edits files, runs checks, and opens a draft PR. Teammates can steer the run in the thread. This is a human-triggered agent surface, not a documented machine-consumable queue. ([Slack app](https://posthog.com/docs/slack))
- Polling Slack would add another OAuth surface, rate limit, formatting parser, and deduplication problem while discarding structured PostHog report state. Poll PostHog directly and use Slack only to notify or let humans intervene.

## Deduplication, noise, and recurrence

- Exception fingerprinting collapses repeated events into an issue. ([issues and exceptions](https://posthog.com/docs/error-tracking/issues-and-exceptions))
- Self-driving then deduplicates and groups related signals, including cross-source evidence, into one report. ([signal sources](https://posthog.com/docs/self-driving/inbox/sources), [reports](https://posthog.com/docs/self-driving/reports))
- Scouts retain memory across runs so they can avoid resurfacing the same condition. A resolved report is terminal; a later recurrence becomes a fresh report rather than reopening the old incident. ([scouts](https://posthog.com/docs/self-driving/scouts), [reports](https://posthog.com/docs/self-driving/reports))
- Log alerts provide M-of-N checks and cooldowns before the signal stage. Error tracking also supports server-side project-wide and per-issue token-bucket rate limits. Events above those limits are dropped before storage and billing, so the agent loop cannot investigate what was never ingested. Bypass rules can guarantee matching critical exceptions are ingested, but those events are billed. ([log alerts](https://posthog.com/docs/logs/alerts), [error tracking rate limiting](https://posthog.com/docs/error-tracking/rate-limiting))

## API and security constraints for a local poller

- Use the EU private API host (`https://eu.posthog.com`) for this EU project. Private endpoints authenticate with a personal API key; create the narrowest key possible (`task:read` for reports, and only `error_tracking:read` if direct issue evidence is required). Keep it outside the repository and send it as a bearer token. ([API overview](https://posthog.com/docs/api), [personal API keys](https://posthog.com/docs/api/personal-api-keys))
- General private CRUD endpoints are limited to 480 requests/minute and 4,800/hour; analytics endpoints are 240/minute and 1,200/hour; `/query` is 2,400/hour. Limits apply across the team, not per key. A five-minute bounded poll is far below these limits. ([API overview](https://posthog.com/docs/api))
- Do not implement recurring raw-event polling through `/query`; PostHog explicitly says it is not a supported export mechanism and may rate-limit or reject export-like queries. Poll structured reports/issues, or use destinations/batch exports for actual streams. ([query API](https://posthog.com/docs/api/queries))
- Self-driving requires organization-level AI data processing approval and GitHub access. Restrict the GitHub App to the intended repository where possible; its documented permissions include repository metadata read and code/issues/PR read-write. ([setup](https://posthog.com/docs/self-driving/setup), [GitHub integration](https://posthog.com/docs/libraries/github))
- Treat error messages, log text, event properties, and session evidence as untrusted and potentially sensitive. Fetch bounded fields, redact before agent prompts and PRs, and never copy raw production payloads, access codes, or tokens into logs or issues.

## Practical decision

Run a short native Self-driving trial first with the Error Tracking and Logs sources, one explicitly selected GitHub repository, a conservative priority threshold for automatic implementation, and human merge. Add Slack only for visibility. Build the outbound-only devbox poller only if the native cloud sandbox cannot run required local dependencies or if policy requires code execution on the devbox.
