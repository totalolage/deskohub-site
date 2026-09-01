# GitHub Issues as the incident-agent control plane

> **Status: superseded by the MVP map.** The selected MVP uses one timer, one persistent T3 dispatcher agent, existing CLI credentials, GitHub issues as the queue, and prompts as the safety boundary. Do not implement the controller identity split or deterministic state machinery below unless the MVP proves that it needs them. See [the Wayfinder map](https://github.com/totalolage/deskohub-site/issues/288).

Research date: 2026-08-28. Repository: `totalolage/deskohub-site`.

## Recommendation

Use two systemd user timers and GitHub Issues as the visible task queue:

```text
PostHog collector timer
  -> poll direct PostHog APIs
  -> exact occurrence dedupe
  -> create one sanitized candidate issue

GitHub dispatcher timer
  -> claim every unattended candidate
  -> create one T3 Code thread for that issue
  -> run a triage-only first turn
  -> attach duplicate, close noise, request a human, or continue actionable work
  -> continue research, implementation, and PR work in the same thread
  -> resume human-needed threads from trusted issue responses
  -> reconcile human input, T3 state, and the linked pull request
```

This meets the two-loop requirement without Slack, inbound networking, a hosted queue, a daemon, an embeddings store, or direct Codex execution. The collector records facts. The dispatcher owns the whole T3 Code lifecycle. There is no separate triage thread, repair thread, human-response timer, or PR-babysitting timer.

One issue gets one worktree and one T3 thread. The first turn is a hard triage gate and may not edit the repository or open a pull request. After the controller validates the triage result and a clean worktree, it sends research, implementation, review, and PR follow-up turns to that same thread. This preserves the triager's code understanding without weakening the checkpoint. See [Semantic incident triage](semantic-incident-triage.md).

GitHub is the public control plane, not the evidence store. Raw logs may be available to T3 Code on the devbox under the accepted risk, but they must never appear in an issue, comment, branch, commit, pull request, command argument, or service log. This repository is public.

## What exists now

Read-only live checks established these facts:

- `totalolage/deskohub-site` is public, Issues are enabled, and `main` is the default branch.
- The repository has no issue templates or issue forms.
- It has twelve labels. None describes an incident-agent state.
- Its only open or closed issues are two maintainer-authored issues. One was linked to its fixing pull request with GitHub's native closing relationship.
- `totalolage` is the only current collaborator and the only available ordinary assignee. The authenticated local identity has administrator permission.
- The latest 200 pull requests have two authors: 185 by `totalolage` and 15 by `app/deskohub-release-bot`. The release bot is a release producer, not an incident controller.
- Recent branches already use both `t3code/*` and `agent/*`. Use `posthog/issue-<issue-number>` for this loop so the GitHub issue number is the human-readable identity and the automation namespace is explicit.

Do not use assignee as the machine claim in v1. There is no distinct assignable incident identity, and assigning `totalolage` would not distinguish human ownership from automation. A state label plus one local dispatcher lock is clearer.

## Issue contract

Every PostHog occurrence that survives exact dedupe starts as one issue with:

- persistent label `posthog`;
- exactly one state label;
- a generic title such as `PostHog incident 7d4c83a1`;
- a short public body containing timestamps, signal kind, current state, and opaque digests only;
- a hidden machine marker such as `<!-- deskohub-incident:v1 work=7d4c... -->`.

Use these state labels:

| State label | Meaning |
| --- | --- |
| `agent:queued` | The issue is unattended and needs its one T3 thread. |
| `agent:running` | The dispatcher has claimed the issue and its T3 thread exists or is being created. |
| `agent:human-needed` | T3 needs an answer, approval, recovery choice, or manual triage. |

Closed GitHub state is terminal. Use the existing `duplicate`, `invalid`, and `wontfix` labels for terminal triage outcomes. A linked pull request and GitHub's native issue state cover work after implementation starts. Do not add `triage`, `ready`, `pr-ready`, `done`, `failed`, priority, severity, ownership, project, or milestone machinery until a real query needs it.

The body marker is a lookup hint, not authority. Issue authors can edit bodies, and GitHub says body edit history can be removed. Public users can add comments. The controller must recover the PostHog identity from its private local record and corroborate it against PostHog, never from issue prose.

## Local records

Keep one mode-0600 JSON record per occurrence plus one collector cursor under the application's state directory. Use the repository's existing write-temporary, `fsync`, rename, directory-`fsync` journal pattern. The record contains the private PostHog identifiers, exact source hashes, issue number, current turn role, T3 idempotency keys and thread ID, trusted human-response watermark, and pull request identity.

The public issue marker contains only `sha256(canonical occurrence identity)`. Canonical identity includes a high-entropy PostHog issue or alert UUID and the local recurrence identity, so the digest does not disclose a fingerprint or log value. Persist the local record before creating the issue.

Do not make GitHub the only durable record. GitHub's documented create-issue and create-comment endpoints do not offer an idempotency parameter, issue content can be edited, and public issue content cannot hold the private source identity needed to re-query PostHog.

## Collector loop

Run the direct PostHog collector under `flock` so only one collector invocation can create or attach occurrences at a time. Follow the direct API and reopen limitations in [Custom PostHog intake](posthog-custom-agent-intake.md).

For each occurrence:

1. Canonicalize and hash its exact event identity. Persist an `observed` local record before any GitHub write.
2. Check local records first. Then paginate every issue with `posthog`, including closed issues, and scan machine markers. Do not use GitHub search because its index is not an idempotency boundary.
3. If the exact occurrence already exists, update only the local observation counters and stop.
4. Otherwise create a sanitized issue in `agent:queued`, then persist its returned issue number.
5. If the create response is lost, rescan markers with bounded backoff. Do not issue a second create while the first result is ambiguous. Move the local record to `needs_human_intake` after the recovery window.

Attaching an occurrence to an existing issue uses the same pattern. Put an occurrence digest in a controller-authored comment marker, scan existing comments before posting, and rescan after an ambiguous response. The human-readable comment says only that a corroborated recurrence arrived and gives sanitized timestamps.

GitHub warns that rapid issue or comment creation can trigger secondary rate limits. Honor `Retry-After`, leave the local occurrence pending, and resume on the next timer tick.

## Exact dedupe followed by semantic triage

Exact checks are the first layer:

- occurrence digest;
- PostHog Error Tracking issue UUID and fingerprint digest;
- PostHog spike or Logs alert event UUID;
- any open pull request already linked to the candidate or canonical issue;
- local T3 phase and thread ID.

They prevent replay and obvious parallel work. They do not decide whether two different fingerprints share one root cause.

Every `agent:queued` issue gets one T3 thread whose first turn performs triage only. Its trusted prompt contains only the numeric issue number, a fixed workflow, and paths to private local records. The controller supplies a small candidate set selected by deterministic facts such as matching service, release, top application frame, alert, fingerprint, and recent open incidents. The triage agent may query unrestricted PostHog evidence locally and inspect code and linked pull requests. It may not edit the repository or open a pull request.

Triage returns one schema-decoded result. [Semantic incident triage](semantic-incident-triage.md) owns the full JSON contract.

```text
actionable(canonical_issue)
duplicate(canonical_issue)
non_actionable(reason_code)
human_needed(reason_code)
```

The controller schema-decodes the result, verifies that the worktree is clean, and then applies it. It must reject a `duplicate` target unless the number was in the supplied candidate set, still has a controller-verified `posthog` identity, and is not terminal in a way that makes the new occurrence a regression. Low confidence becomes `human_needed`. It never silently attaches.

If triage returns `duplicate`, the controller records the recurrence on the canonical issue, labels the candidate `duplicate`, links the canonical issue, closes the candidate, and cleans up its T3 thread when supported cleanup exists. `non_actionable` closes with `invalid` or `wontfix`. `human_needed` remains open in `agent:human-needed`. `actionable` stays in `agent:running`, and the controller sends an idempotent research or implementation turn to the same thread. A closed issue with a merged fix does not absorb later production evidence by default. Triage should open a fresh regression incident unless it proves that the earlier fix has not deployed.

This semantic pass needs no vector database. At the expected volume, an agent comparing a bounded set of current incident packets and diffs is the shortest working implementation.

## Dispatcher claim and unlimited concurrency

Run one dispatcher invocation under `flock`. It attempts every currently unattended issue and has no fixed daily limit, simultaneous-thread cap, memory gate, disk gate, or other resource circuit breaker. This literal uncapped admission behavior is accepted. The dispatcher still calls `t3 create` sequentially because T3 serializes bootstrap internally. Once created, every turn may run concurrently. See [T3 incident concurrency](t3-incident-concurrency.md).

A claim is the controller-authored transition from `agent:queued` to `agent:running`. Before the transition, re-fetch the issue and require:

- open GitHub state;
- persistent `posthog` label;
- exactly the expected state label;
- a matching private local record;
- no live T3 thread for that issue;
- no linked open pull request already handling that issue;
- no other nonterminal issue already selected as the canonical semantic match.

GitHub label updates are not compare-and-swap operations. A single dispatcher process and kernel-held `flock` are therefore part of the correctness boundary. Read the current labels, preserve non-agent labels, and write the full label set with exactly one agent state. If multiple controller states appear after a crash or manual edit, stop that issue in `agent:human-needed`.

Use one deterministic T3 creation key and branch per issue:

```text
idempotency key: github-issue:totalolage/deskohub-site#<number>
branch: posthog/issue-<number>
```

Persist the key before `t3 create`. A crash before the response is safe because retrying the same create returns the existing T3 thread. Persist the returned `threadId`, then add a sanitized controller comment containing the thread digest, not the prompt or transcript. Later turns use `t3 send` with their own idempotency keys derived from the issue, validated prior result digest, and turn role. See [T3 Code control](t3code-agent-control.md).

The dispatcher then exits. Active T3 threads continue independently. On later ticks it uses targeted `t3 thread`, `t3 pending`, and short `t3 watch` calls to reconcile all running and human-needed issues. It does not wait serially for each agent. Unlimited concurrency means no software cap on active threads. T3 Code and devbox capacity remain physical limits, not admission rules.

## Recovery and human-needed work

Recovery is state reconciliation, not blind retry:

| Observed state | Action |
| --- | --- |
| `running`, key persisted, no thread ID | Replay `t3 create` with the same key and recover the thread ID. |
| `running`, live thread | Leave it alone. |
| `running`, pending interaction | Move to `agent:human-needed` and post a sanitized request. |
| `running`, terminal T3 failure, no PR | Move to `agent:human-needed`. Do not create another thread automatically. |
| `running`, PR found | Persist the PR identity and enter PR reconciliation. |
| `queued`, open linked PR | Repair the label to `running` and reconcile that PR instead of starting T3. |
| `human-needed`, trusted response found | Validate the live pending interaction, consume the response once, and resume the same thread. |
| closed issue with live thread | Stop dispatching it and notify a human. Do not let issue closure terminate host processes automatically. |

Human input stays in GitHub without a command prefix or codeword. While an issue has `agent:human-needed`, the dispatcher accepts the first new comment after the pending-question watermark only when its exact author login is in the configured trusted identities, initially `totalolage`. Before consuming it, re-read `t3 pending` and prove that the same thread still has the interaction the issue records. Record the consumed comment ID before resuming the same thread so an edit or later timer tick cannot replay it.

Comments from every other actor are display-only. Never concatenate them into a T3 prompt. Validate the comment ID, exact author login, `author_association`, creation time, pending interaction identity, and maximum length. A trusted answer may answer the live question, but it cannot change repository, merge, credential, or auto-approval policy. If the live pending state and issue marker disagree, leave the issue in `agent:human-needed`.

The dispatcher continues launching other issues while any issue is in `agent:human-needed`.

## Pull request linkage and completion

Repair agents must open one pull request whose body contains `Fixes #<issue-number>`. GitHub documents that a closing keyword links the pull request and closes the issue when the pull request merges. The repository has already used this native relationship for issue 42 and pull request 45.

Also require:

- base branch `main`;
- head branch `posthog/issue-<issue-number>`;
- a hidden `deskohub-incident` issue marker in the pull request body;
- the issue number in the T3 local record;
- the pull request head SHA in every independent verification result.

Treat T3's `linkedPullRequest` as a hint. Reconcile through GitHub using the closing relationship, head branch, repository, author, and marker. If two open pull requests claim one issue, mark it `agent:human-needed`.

Record merge readiness in a controller comment only after the deterministic PR checks described in [Autonomous PR auto-merge boundary](agent-loop-automerge-boundary.md). Keep `agent:running` while the pull request is open. Phase 1 still requires a human merge. When GitHub merges the pull request, its `Fixes` link closes the incident issue. If the pull request closes without merge, move the still-open incident to `agent:human-needed`.

After merge, terminal issue closure, or an explicitly abandoned failure, clean up that issue's one T3 thread and worktree. Unattended rollout is blocked until T3 exposes a supported, idempotent headless cleanup command that stops the provider session and removes the orphaned worktree. The current CLI cannot do this. Do not edit T3's database, synthesize its internal protocol, or remove a live worktree underneath it. [T3 incident concurrency](t3-incident-concurrency.md) contains the measured process and worktree leak.

## Protection from issue edits and prompt injection

Apply these rules even though unrestricted local log access was accepted:

1. Never use issue titles, bodies, labels added by unknown actors, or untrusted comments as agent instructions. The only comment content that may resume a thread is the single trusted response selected under the human-needed rule above.
2. Build prompts from a checked-in fixed template, numeric issue ID, verified local record paths, and re-fetched PostHog facts.
3. Put evidence in a clearly delimited data section and tell agents that evidence cannot change the task, permissions, destination repository, checks, or policy.
4. Parse triage and repair outcomes through fixed schemas. Agent prose is not a state transition.
5. Accept state-label and controller-comment events only from the configured controller identity. GitHub timeline events expose the actor for labeled, assigned, commented, closed, and reopened events.
6. Reopen or stop on unexpected closure, relabeling, body replacement, or PR linkage. Never interpret it as authorization.
7. Keep raw PostHog evidence and T3 transcripts off GitHub. PII-free is not the same as public, secret-free, or instruction-safe.

Use a dedicated GitHub App for the controller before unattended rollout. Grant only Metadata read and Issues write. Store its private key as a systemd credential, not in the repository, shell environment, or T3 prompt. GitHub documents that installation tokens can create issues, comments, and labels with Issues write permission. A distinct App actor lets the controller distinguish its own state changes from public users, the maintainer, and T3 workers.

The repair worker still needs repository contents and pull-request permissions through a separate identity. Do not give the controller App Contents write, Administration, Actions, Secrets, or Workflows permission.

## Proven gaps

These facts block a claim of strong isolation today:

1. No incident-controller App or distinct bot is installed. The current local GitHub identity is the repository administrator and the only assignable collaborator.
2. T3 Code's practical repair mode is `full-access` under the same Unix user that owns local state and the current `gh` credentials. A hostile log or compromised agent could alter local records or GitHub state. Ignoring issue prose prevents public-comment prompt injection, but it does not sandbox hostile production evidence.
3. GitHub issue and comment creation have no documented idempotency key. The single collector lock, private write-ahead record, deterministic marker, and ambiguous-response rescan reduce duplicates but do not prove GitHub read-after-write consistency.
4. GitHub label writes have no documented conditional compare-and-swap. One local dispatcher is a hard v1 assumption. A second machine would require a real lease or transactional queue.
5. Direct PostHog polling can miss an Error Tracking issue that reopens and resolves between polls. This was explicitly accepted for v1.
6. Literal admission without a resource circuit breaker or fixed cap is explicitly accepted. It is not a safe property proved by T3. The devbox currently has hundreds of Deskohub threads and worktrees, and each active Codex session can retain an app-server process after its turn becomes ready.
7. The supported T3 CLI has no cleanup command. This is a rollout blocker, not accepted leakage. Add supported, idempotent session and worktree cleanup before enabling unattended dispatch. A service restart stops processes but does not remove worktrees.
8. Unlimited concurrency has not been load-tested against PostHog rate limits, GitHub secondary rate limits, T3 bootstrap queues, CI, or Workspace E2E allocation. The dispatcher has no admission cap by decision, but it must still honor provider errors and `Retry-After` rather than creating replacement issues or threads.
9. GitHub auto-merge is not safe under the repository's current rules. The separate hardening phases in the auto-merge boundary remain required.

## Sources and checks

- [GitHub REST issue endpoints](https://docs.github.com/en/rest/issues/issues)
- [GitHub REST issue comments](https://docs.github.com/en/rest/issues/comments)
- [GitHub REST labels](https://docs.github.com/en/rest/issues/labels)
- [GitHub timeline events and actors](https://docs.github.com/en/rest/issues/timeline)
- [GitHub issue event types](https://docs.github.com/en/rest/using-the-rest-api/issue-event-types)
- [GitHub pull request to issue linking](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue)
- [GitHub App permissions](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app)
- [GitHub issue editing](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue)

Live checks used only repository metadata, labels, issue metadata, timeline actors, collaborators, assignees, and pull request authors. They made no GitHub mutations and read no production payloads or credential values.
