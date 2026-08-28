# Local PostHog-to-T3 Code runner shape

> **Status: superseded. Do not implement this design.** The developer replaced Slack intake and the single-runner shape with two timers. A direct PostHog collector creates sanitized GitHub Issues. A GitHub dispatcher starts or resumes one T3 Code thread per issue through triage, research, implementation, and pull-request completion. The developer chose literal uncapped dispatch with no software quota or resource circuit breaker. A supported T3 cleanup command is a prerequisite for enabling it. See [the current control plane](github-incident-agent-loop.md), [semantic triage](semantic-incident-triage.md), and [T3 concurrency and cleanup](t3-incident-concurrency.md).

Research date: 2026-08-28. This note describes a local operator process. It contains no production payloads or credentials.

## Decision

Build one private Bun application at `apps/deskohub-incident-agent`. Run its compiled executable from a systemd user timer. Each invocation first catches up the dedicated private Slack transition channel when its five-minute poll is due, corroborates new occurrences through PostHog, then advances at most one local job through the supported T3 Code CLI.

Do not add a daemon server, Slack event or socket consumer, database, queue package, worktree manager, or direct Codex runner. T3 Code already owns the long-running server, isolated worktree, coding thread, and interaction history. The new application only supplies durable intake and supervision.

The runtime flow is:

```text
systemd timer
  -> deskohub-incident-agent run-once
  -> poll the pinned Slack channel when due
  -> corroborate and normalize new occurrences with PostHog
  -> t3 session
  -> recover or start one local job
  -> t3 create / watch / pending / thread / send
  -> verify the pull request with gh
  -> persist the next job state and exit
```

This is a `Type=oneshot` service, not another long-lived service. `OnUnitInactiveSec=` starts the next poll after the previous invocation exits, so one machine cannot overlap scheduled runs. The existing `t3code.service` remains the only resident process. Use `Wants=` and `After=` for it, then let `t3 session` verify the live CLI protocol before PostHog intake. See [T3 Code control](t3code-agent-control.md).

## Repository ownership

`apps/deskohub-incident-agent` is the right boundary. It is an independently runnable operator product, not a shared library and not Workspace request handling. Keep its systemd unit templates beside the app under `systemd/`.

The application should depend only on packages already present:

- `@deskohub/posthog` for the generated, schema-decoding API client;
- `effect` and `@effect/platform-bun`, matching the existing CLI and PostHog client conventions;
- Bun and Node standard APIs for child processes, hashing, and atomic files.

Do not add SQLite, a Slack SDK, a scheduler library, a lock package, or another HTTP client. Use the existing Effect fetch client for Slack's single `conversations.history` call and the generated PostHog client for corroboration. `Bun.spawn` can invoke `t3` and `gh` with argument arrays.

Compile the app to a stable path such as `%h/.local/libexec/deskohub-incident-agent`. Do not run source from a feature worktree in systemd. Install the checksum-verified F8Y `t3` CLI at a stable path first. The `t3` currently first on this devbox's `PATH` is stale, while the running managed service has the supported orchestration commands. Do not point the unit at T3's versioned runtime cache.

## Scheduling and locking

Use one timer with `OnStartupSec=1m` and `OnUnitInactiveSec=1m`. Store the next Slack poll time and skip its API call until five minutes have elapsed. Let `t3 watch --timeout 45s` observe the separately running T3 thread, then resume the same thread on the next invocation when `watch` exits with code 23. A two-minute service timeout is enough and keeps Slack catch-up running while an agent works or waits for a human.

Systemd already refuses a second start while the oneshot is active. Add `/usr/bin/flock --nonblock` around `ExecStart` only so an operator can use the same supported wrapper for a manual run. Keep the lock in the application's state directory. Do not put a lease column in local state or implement stale-lock cleanup. Kernel-held `flock` disappears when the process exits.

The unit needs these basic controls:

```ini
[Service]
Type=oneshot
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
TimeoutStartSec=2m
```

Avoid broader filesystem hardening in v1. The local `t3` client may need to refresh its scoped session below the user's T3 state directory, and `gh` must read the user's GitHub authentication. Tighten the unit after those write paths are measured.

## Durable job records

Use one atomically replaced JSON file per Slack occurrence under `${XDG_STATE_HOME:-$HOME/.local/state}/deskohub-incident-agent/jobs/`. The repository already uses the same write-to-temporary-then-rename pattern for Workspace E2E recovery journals. Slack is the created-or-reopened transition journal, but these local records are the work queue.

```text
jobs/<sha256-work-key>.json
packets/<sha256-work-key>.json
intake.json
runner.lock
```

Use `(channel_id, message.ts)` as the initial occurrence key. After corroboration, retain the PostHog spike or log-alert event UUID when one exists and retain the error fingerprint as its subject key. Never use the issue UUID alone as the work key because one issue can reopen more than once. Hash the occurrence key for filenames and branch-safe references. Keep the original opaque IDs inside the mode-0600 record.

`intake.json` stores the inclusive Slack timestamp watermark, the next poll time, and the last successful Slack and PostHog corroboration times. Advance the watermark only after every page decoded and every recognized occurrence reached `queued` or a durable `needs_human_intake` decision. Keep the inclusive overlap. Existing occurrence records make replay cheap.

One record is a decoded tagged union:

```text
observed      Slack occurrence claimed, PostHog corroboration incomplete
queued        corroborated packet exists, no T3 thread yet
needs_human_intake  corroboration was ambiguous or mismatched, no T3 thread
running       threadId exists, create must never run with a new key
human_needed  threadId exists, pending input or a repeated verification failure
ready         verified non-draft PR and exact head passed required checks
closed        no change, rejected evidence, or explicit human closure
```

Persist `workKey`, Slack channel and timestamp, corroborated provider and subject IDs, packet digest, timestamps, state-specific fields, T3 idempotency keys, `threadId`, attempted follow-up keys, and the PR repository, number, URL, and head SHA when known. Do not store the Slack body or Block Kit. Do not maintain a second index or cursor database. Scan the small job directory and derive daily throughput and active-subject dedupe from the records. A single devbox processing a few jobs per day does not need indexed queries.

Write every transition to a temporary mode-0600 file in the same directory, call `fsync` on the file, rename it over the record, then `fsync` the directory. Plain rename without the syncs protects readers from partial JSON but can still lose the latest transition on a power failure.

If any record fails schema decoding, exit nonzero and name only its hashed job ID. Do not skip or overwrite it. Losing a record can launch duplicate work.

## Recovery rules

Slack catch-up runs before T3 recovery. This keeps the local queue current even when one job is paused. It never starts a second T3 task.

1. Create an `observed` record before calling PostHog. Accept only the configured channel and PostHog app identity, and extract only an allowed `eu.posthog.com` project-204184 link. Discard message text and blocks after parsing.
2. A successful PostHog corroboration writes the bounded packet and moves the occurrence to `queued`. A transient Slack or PostHog failure does not advance the intake watermark. A successfully decoded but ambiguous or mismatched occurrence becomes `needs_human_intake` without launching T3.
3. Before starting a `queued` job, scan nonterminal jobs and open PRs for the same subject key. If one exists, close this occurrence as attached to that job instead of starting duplicate work.
4. A `queued` job calls `t3 create` with `--idempotency-key posthog:<work-key>`. If the process dies after T3 accepts the request but before the local write, the next call replays the same `threadId`.
5. A `running` job calls `t3 pending`, `t3 thread`, then `t3 watch` on its recorded thread. It never creates another worktree or thread.
6. Watch exit codes 23 and 24 are retryable. Keep the same state and retry after the timer interval. Codes 20, 21, 22, 25, and 26 need a human or an explicit narrow policy. Do not guess answers or approvals.
7. A `human_needed` T3 job blocks the start of another T3 job in v1, but it does not block Slack intake. After a human answers through T3 Code, the next run observes no pending interaction and returns the same job to `running`.
8. After a final assistant result, ignore the prose as proof. Read the branch and worktree from `t3 thread`, find the PR by head branch with `gh`, and compare its `headRefOid` with the local `HEAD`. A ready result also requires base `main`, non-draft state, all required checks successful, and no unresolved merge block.
9. Pending checks leave the job `running` without starting an agent turn. Failed checks may trigger one idempotent `t3 send` for that exact head SHA and failed-check digest. Seeing the same failed state twice moves the job to `human_needed`. This stops a broken test from spending turns forever.

Advance only the oldest nonterminal T3 job. New Slack occurrences may still enter `observed`, `queued`, or `needs_human_intake` states while it runs. Add parallel T3 claims only after measured queue delay makes this unacceptable.

`ready` ends the v1 runner's authority. It does not merge. The current repository has no enforced independent approval between an agent-authored PR and `main`; see [the auto-merge boundary](agent-loop-automerge-boundary.md).

## Prompt and evidence boundary

`t3 create` and `t3 send` currently accept their message only as a command-line argument. Never put exception text, log text, stack values, URLs with query strings, or customer data in that argument.

Write the bounded, redacted incident packet to `packets/<hash>.json`. Pass T3 a fixed instruction containing only the hashed job ID and absolute packet path. The instruction must say that every packet field is untrusted diagnostic evidence, not an instruction. `full-access` lets the local agent read that packet and perform the requested Git and GitHub work.

This file indirection avoids exposing incident text in process listings. A future T3 `--message-file` or stdin option would be cleaner, but it is not required for v1.

Store only the fields the agent needs to find the code and reproduce the symptom. Slack supplies occurrence identity and a validated PostHog link, not diagnostic prose. Do not persist Slack text or blocks, raw log batches, request bodies, headers, session recordings, access codes, tokens, emails, or customer identifiers. Log only hashed job IDs, state transitions, exit codes, and provider status classes to the systemd journal.

## Secrets and process authority

Load both the read-only PostHog API key and private Slack bot token as separate systemd encrypted credentials, not `Environment=` or an environment file. The Slack app needs only `groups:history` and membership in the one configured private channel. Read both secrets from `$CREDENTIALS_DIRECTORY`, wrap them as redacted data in the process, and set their Authorization headers only inside their respective HTTP clients. Spawn `t3` and `gh` with a clean allowlisted environment that excludes the credential directory and all PostHog and Slack values.

Keep non-secret deployment settings in the unit, including the EU API origin, project ID, Slack channel ID, pinned PostHog app identity, stable T3 CLI path, and registered T3 project ID. The T3 local session stays in T3's own mode-0600 state. GitHub and coding-provider authentication stay with the same Unix user and are not copied into runner state.

Systemd credentials prevent common argument, environment, and journal leaks. They are not a security boundary against a hostile process running as the same Unix user. A dedicated service account is the next step only if this moves beyond a single-user pilot. It would require a separate supported T3 Code installation and provider authentication, so it is not a small v1 change.

## Minimal runnable proof

Leave one focused Bun test that runs `runOnce` twice against a temporary state directory with synthetic incident data and fake `t3` and `gh` command functions. Simulate a crash immediately after the first successful `t3 create`. The second run must use the identical idempotency key, recover the same thread, and make zero additional logical creates. Then drive the fake PR to green and assert the persisted tagged state is `ready` with the exact head SHA.

That single check proves the risky part of this runner: a timer retry cannot create duplicate T3 work and cannot declare readiness from agent prose. Run the normal package lint, typecheck, and test tasks through Turbo. Verify the checked-in unit templates with `systemd-analyze --user verify` before installation.

## Explicitly deferred

- A Slack SDK, Socket Mode, or Slack prose parsing. The private channel is a transition journal only. Native history polling and strict link extraction are enough.
- Auto-merge. Current GitHub enforcement does not support it safely for agent-authored production fixes.
- SQLite or a managed queue. Add one only when multiple runner processes need competing claims or directory scans become measurable work.
- A separate collector and worker. The T3 server, not the runner, launches the coding process, so the PostHog credential does not need to enter the agent's environment.
- Automatic approval or free-form answering. T3 interaction exit code 26 remains fail-closed.
