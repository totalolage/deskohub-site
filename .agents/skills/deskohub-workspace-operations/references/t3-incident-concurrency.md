# T3 incident-agent concurrency on the devbox

> **Status: deferred by the MVP map.** The MVP accepts existing T3 lifecycle behavior, uncapped agent starts, and manual cleanup. Do not make headless cleanup or resource admission a rollout prerequisite unless the prototype exposes a real failure. See [the Wayfinder map](https://github.com/totalolage/deskohub-site/issues/288).

Research date: 2026-08-28

## Conclusion

Do not impose a fixed daily or simultaneous-agent quota. The user explicitly wants unlimited dispatch. That can mean unlimited work over time, but it cannot mean admitting work after the machine has run out of memory or disk.

The smallest safe policy is:

1. One dispatcher process scans unattended GitHub issues.
2. It calls `t3 create` sequentially. It does not use `Promise.all` or start several CLI processes at once.
3. T3 turns may run concurrently without a configured count ceiling.
4. The dispatcher pauses new creates while T3 is unavailable, memory is low, or the filesystem is nearly full. Existing turns continue.
5. Each issue uses one stable T3 idempotency key and one explicit branch derived from the GitHub issue number.
6. A supported headless T3 cleanup command is a prerequisite for unattended production use.

The last item is not optional. The installed F8Y CLI can create, send, watch, and inspect threads, but it cannot archive, delete, stop, or remove their worktrees. A completed Codex turn leaves a live app-server session in `ready` state. T3 archive keeps the worktree. Literal unbounded dispatch would leak processes until the next T3 service restart and keep leaking worktrees after the restart.

## What T3 serializes

T3 already protects thread bootstrap correctly:

- The orchestration engine has one process-wide bootstrap semaphore.
- The dispatcher holds it across thread creation, optional `origin` fetch, branch creation, worktree creation, setup-script launch, and acceptance of the first turn.
- The event-store command queue is also handled by one worker.

Concurrent `t3 create` calls therefore wait rather than racing Git branch or worktree creation. This is useful correctness, but it is not an admission limit. The semaphore waiters and orchestration command queue are unbounded. Starting many CLI calls concurrently only moves the queue into T3 memory and open client connections. [Bootstrap lock and unbounded command queue](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/Layers/OrchestrationEngine.ts#L98-L99), [bootstrap lock coverage](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/Services/OrchestrationCommandDispatcher.ts#L540-L555), [worktree bootstrap](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/Services/OrchestrationCommandDispatcher.ts#L420-L509).

The Deskohub setup script only copies selected ignored files into the new worktree. It does not wait for dependency installation or a build. T3 launches that script in a terminal and accepts the first provider turn without waiting for the script to exit. Several agents may therefore run setup scripts, installs, checks, and builds at the same time even though their worktrees were created one at a time. [Setup-script launch behavior](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/Services/OrchestrationCommandDispatcher.ts#L317-L419).

## What is not limited

The inspected F8Y source and CLI contract contain no configured limit for:

- active provider sessions;
- simultaneous turns on different threads;
- worktrees per project;
- waiting bootstrap requests;
- local build or test processes started by agents.

Each Codex thread starts its own `codex app-server` child process. The adapter retains that process in its session map after a turn completes so the next turn can continue the same provider session. It stops the child only when T3 receives an explicit session stop or thread deletion, when a replacement session starts for that same thread, or when the T3 service shuts down. [Codex session creation](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/provider/Layers/CodexAdapter.ts#L1661-L1740), [per-session app-server spawn](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/provider/Layers/CodexSessionRuntime.ts#L1125-L1170).

`t3 watch` treats `ready` as terminal for the watched turn. It does not stop the provider session. A successful watch is therefore not a resource-cleanup event. [Watch terminal states](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remoteWatch.ts#L14-L35).

## Devbox evidence

Read-only checks on 2026-08-28 found:

| Resource | Observation |
| --- | ---: |
| Logical CPUs | 12 |
| Physical memory | 31 GiB |
| Swap | 15 GiB |
| Root filesystem free | 952 GiB |
| Git worktrees registered for Deskohub | 232, including the main checkout |
| Live T3 Deskohub threads | 245 |
| Live T3 Deskohub threads with a worktree path | 238 |
| Archived live T3 Deskohub threads | 165 |
| Deskohub T3 sessions recorded as `ready` | 136 |
| Running Codex app-server processes after a recent T3 restart | 1 |
| RSS of that Codex app-server | about 450 MiB |
| T3 service cgroup memory during this investigation | about 3 to 8.4 GiB |
| T3 service cgroup memory limit | none |
| T3 service task limit | 38,266 |

The 136 recorded ready sessions and one process are consistent with service restart behavior: dormant thread records survive, but their app-server children do not. If autonomous dispatch creates many threads between restarts, the children remain until explicitly stopped or the service restarts.

Worktree disk cost varies sharply. A sample of ten existing Deskohub worktrees ranged from about 336 MiB to 2.7 GiB, depending mainly on whether a task installed dependencies or produced build artifacts. The main checkout itself occupied about 7.5 GiB. Disk is not tight today, but a fixed task count cannot predict its future use.

## Collision behavior

`t3 create` is idempotent only when the caller reuses the same idempotency key under the same authenticated CLI principal. T3 derives both the command ID and thread ID from that value. A replay returns the original receipt.

Without `--branch`, T3 derives the branch from only the first eight hexadecimal characters of the identity hash. That is a 32-bit namespace. It is fine for interactive work but a poor lifetime namespace for an unlimited automation loop. A branch collision causes `git worktree add -b` to fail and bootstrap cleanup to run. [CLI identity and default branch](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/http.ts#L217-L306), [temporary branch format](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/packages/shared/src/git.ts#L95-L105).

Use the GitHub issue as the task identity:

```text
idempotency key: github-issue:<owner>/<repo>#<number>
branch: posthog/issue-<number>
```

The issue number is unique in the repository and remains stable across retries, agent restarts, and repeated PostHog occurrences. The semantic triage layer decides whether an event belongs to that issue before dispatch reaches T3.

## Cleanup blocker

The installed local and remote F8Y CLI command trees expose no archive, delete, session-stop, or worktree-remove operation. The server contracts contain `thread.archive` and `thread.delete`, and the browser client can invoke them, but they are not available to a headless local service through the supported CLI.

Even `thread.delete` would not remove a worktree by itself. The deletion reactor stops the provider session and closes terminals only. The web client separately asks the user whether to remove an orphaned worktree, then calls the VCS remove operation. Archive only hides the thread and retains the provider and worktree state. [Deletion reactor](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/Layers/ThreadDeletionReactor.ts#L36-L75), [browser worktree removal](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/web/src/hooks/useThreadActions.ts#L273-L426), [CLI command registration](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remote.ts#L1281-L1311).

Do not paper over this by editing T3's SQLite database, synthesizing WebSocket commands, or removing a worktree underneath a live T3 session. A missing worktree can be recreated by the provider reactor, and the T3 thread would still retain stale lifecycle state.

Add one supported, idempotent CLI operation before enabling the loop. It should stop the provider session, delete or archive the thread according to policy, and remove an orphaned worktree after checking that no other live thread references it. Completion must be retryable if the process dies between those steps. A command shaped like this is sufficient:

```text
t3 cleanup <thread-id> --remove-worktree --yes
```

Keep a worktree while its GitHub issue or pull request is open. Run cleanup after merge, issue closure without a PR, or an explicit terminal failure that no longer needs investigation. The GitHub issue and PR are the durable audit record, so keeping hundreds of archived T3 worktrees adds cost without adding useful history.

## Smallest admission backpressure

The issue-assignment loop should have no fixed concurrency number. It should still fail closed on resources:

```text
admit next issue only when:
  t3code.service is active
  AND root filesystem usage is below 90%
  AND MemAvailable is at least 8 GiB
  AND no previous cleanup operation is stuck
```

These are circuit breakers, not throughput quotas. The next cron tick resumes automatically when the machine recovers. Keep the thresholds as local service configuration because this devbox may gain memory or storage later.

Call `t3 create` one issue at a time. That matches T3's own global bootstrap lock and avoids an unbounded pile of waiting HTTP requests. Once each create returns, its provider turn can run alongside every prior turn.

Do not gate on CPU load alone. High CPU slows checks but does not by itself corrupt state. Low memory and low disk can kill processes, truncate writes, or leave partial work, so they deserve hard admission gates.

## Git and GitHub pressure

T3 serializes only its own bootstrap fetch and worktree creation. Agents later running Git commands in linked worktrees share the repository's refs. Git lockfiles prevent silent ref corruption, but simultaneous fetches or ref updates can fail and should be retried on the same issue rather than creating another task.

Distinct issue-number branches avoid push collisions. `t3 create --start-from-origin` gives each new task a fresh base, so the initial prompt should tell the agent not to fetch or rebase speculatively.

GitHub gives the current authenticated user 5,000 REST requests per hour. It also applies secondary limits, including 100 concurrent API requests and general content-creation guidance of no more than 80 mutations per minute or 500 per hour. GitHub recommends serial API requests and at least one second between mutative requests. A 403 or 429 must honor `Retry-After` or the reset time and leave the same issue eligible for retry. It must not create a replacement issue or T3 thread. [GitHub REST API limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), [GitHub REST API best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api?apiVersion=2026-03-10).

This repository scopes Workspace CI concurrency per pull request, so separate incident PRs can run CI at the same time. Workspace E2E has its own three-shard allocation queue and waits up to 15 minutes for a shard. A burst beyond three PRs does not justify limiting agents, but it can delay or fail merge validation. The PR babysitting loop should leave the issue assigned and retry the same check or turn after capacity returns. [Workspace CI concurrency](../../../../.github/workflows/workspace-tests.yml), [Workspace E2E allocation](../../../../apps/deskohub-workspace/e2e/coordination/allocation.ts), [Workspace E2E wait policy](../../../../.github/actions/workspace-e2e-allocation/action.yml).

## Recorded project decision

The developer selected literal uncapped admission with no proactive resource circuit breaker. The dispatcher still calls `t3 create` sequentially because T3 serializes bootstrap, and a supported cleanup command remains a rollout prerequisite. If T3 or the operating system refuses a create, recovery must preserve the same GitHub issue and idempotency key rather than inventing a replacement task. The resource evidence and safer circuit-breaker recommendation above remain documented as an explicitly accepted risk.
