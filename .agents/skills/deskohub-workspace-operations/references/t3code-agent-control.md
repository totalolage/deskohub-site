# Controlling T3 Code from an unattended local service

Research date: 2026-08-28

## Conclusion

Use the F8Y T3 Code local orchestration CLI. It already implements the control loop this project needs:

```text
t3 create -> t3 watch -> t3 thread -> verify the pull request
```

This stays on the devbox. It needs no webhook listener, port forwarding, Slack polling, browser automation, direct database access, or direct Codex invocation. T3 Code still uses its own local HTTP and WebSocket server internally. The CLI discovers that live server from T3's runtime state.

The desktop window does not need to be open. The T3 Code server must be running, and the selected coding provider must already be authenticated. On Linux, the supported way to keep the server alive across logouts and reboots is its systemd user service. [F8Y local orchestration documentation](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/docs/user/remote-access.md#L232-L274) and [F8Y background-service documentation](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/docs/user/background-service.md#L1-L45).

## What is available on this devbox

The running service is active and enabled under `t3code.service`. Its managed binary reports `0.0.35-f8y.20260828.66`. The live environment advertises orchestration CLI API version 1 with `serverAuthoritativeCreate`, `watchResume`, and `pendingInteractions` enabled.

That binary exposes these supported local commands:

- `t3 create`
- `t3 send`
- `t3 watch`
- `t3 pending`
- `t3 answer`, `t3 approve`, and `t3 reject`
- `t3 thread`, `t3 shell`, `t3 session`, and `t3 snapshot`

The F8Y source registers the local and remote variants from the same command definitions. The local variant verifies the recorded process, environment identity, and CLI API version before operating. It does not mutate offline state. [CLI target discovery and authentication](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remote.ts#L404-L468), [local command registration](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remote.ts#L1281-L1311).

There is one packaging problem to fix before relying on this from a timer. `/home/dev/.npm-global/bin/t3`, which is currently first on `PATH`, is an older `0.0.29-nightly` build and does not contain the orchestration commands. The running service uses a newer managed binary under `/home/dev/.t3/runtime/...`. Install the checksum-verified F8Y standalone Linux CLI at a stable path, then have the timer invoke that path. The F8Y release process explicitly publishes a complete standalone CLI and documents checksum verification and installation. [F8Y standalone CLI instructions](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/docs/operations/f8y-release.md#L124-L155).

Do not resolve the service executable through `/proc`, parse the systemd unit, or hard-code its versioned runtime-cache path. Those work today but are private installation details.

## Starting a task

The supported operation is `t3 create`:

```bash
t3 create "$REGISTERED_PROJECT" "$PROMPT" \
  --yes \
  --confirm-create \
  --idempotency-key "posthog:$SIGNAL_KEY" \
  --base-branch main \
  --start-from-origin \
  --runtime-mode full-access
```

`REGISTERED_PROJECT` may be the T3 project ID or the exact canonical workspace root already registered in T3 Code. It should identify the main Deskohub checkout, not an existing secondary worktree. `create` never enrolls a new project. [Server-side project lookup](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/http.ts#L242-L259).

The server chooses the project's default model, creates the branch and isolated worktree, runs the configured setup script, creates the thread, and starts its first turn as one rollback-capable operation. It accepts an optional title, branch, base branch, runtime mode, interaction mode, and `start-from-origin` override. [Server-authoritative create implementation](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/orchestration/http.ts#L210-L345), [CLI create command](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remote.ts#L952-L1029).

Use a stable PostHog issue or signal identity as the idempotency key. T3 derives the command and thread identities from the authenticated local CLI principal plus that key. Retrying the same create returns the prior result instead of starting another agent. The JSON result contains `threadId`, `commandId`, `sequence`, `replayed`, and the idempotency key.

`full-access` is the practical mode if the agent must run checks, push, and use GitHub. It is also the dangerous mode. Do not place raw PostHog logs, exception messages, request values, or user-controlled strings into the instruction section of the prompt. Treat them as quoted evidence and bound their size. A first version should accept only allowlisted repositories and event classes.

## Monitoring the task

Capture `threadId` from `create`, then run:

```bash
t3 watch "$THREAD_ID" --format json --timeout 45m
```

On success, exit code 0 returns one JSON document with `threadId`, `turnId`, terminal `status`, and the final assistant `message`. A timeout is resumable. Run `watch` again with the same thread ID rather than creating another thread. [Watch command](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remote.ts#L1031-L1078), [documented result shape](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/docs/user/remote-access.md#L295-L312).

The useful watch exit codes are:

| Code | Meaning | Loop action |
| ---: | --- | --- |
| 0 | Final assistant result | Inspect thread and validate the PR |
| 20 | Idle, ready, or stopped without a final message | Mark failed and inspect |
| 21 | Interrupted | Mark failed or retry with an explicit policy |
| 22 | Agent error | Mark failed and notify |
| 23 | Watch timeout | Resume `watch` on the same thread |
| 24 | Auth, transport, protocol, or server unavailable | Retry with backoff while the service is healthy |
| 25 | No turn exists | Mark the job malformed |
| 26 | User input or approval is required | Stop unattended progress and notify a human |

The source assigns codes 20 through 26 deliberately. [Watch error contract](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remoteWatch.ts#L77-L147).

On code 26, use `t3 pending --thread-id "$THREAD_ID"` to obtain the bounded, sanitized interaction. Slack is useful here as a human notification and response channel. It should not be the task transport. Do not auto-answer arbitrary questions or approve arbitrary commands. T3's current provider-derived approval projection is fail-closed and does not allow positive approval. [Pending-interaction safety contract](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/docs/user/remote-access.md#L314-L360).

Use `t3 thread "$THREAD_ID"` for the durable thread snapshot. Its contract includes the branch, worktree path, latest turn state, session state, and an optional linked pull request containing repository, number, and URL. [Thread snapshot contract](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/packages/contracts/src/orchestration.ts#L391-L418).

## Pull-request completion

T3 Code controls the coding thread and worktree. The orchestration CLI does not have a command that guarantees a pull request has been opened, made non-draft, or passed required checks.

Put these requirements in the task prompt:

1. Reproduce or establish evidence for the issue before editing.
2. Make the smallest root-cause fix and add the relevant check.
3. Run the repository validation required for the changed area.
4. Commit and push the T3-created branch.
5. Open or update one pull request for that branch.
6. Leave the pull request non-draft only when its required checks pass and report its URL.

After `watch` returns, treat the agent's prose as a lead, not proof. Read the branch and worktree from `t3 thread`, then query the source-control host using its supported CLI. For GitHub, `gh pr view` can verify the head branch, URL, draft state, mergeability, and checks. T3's `linkedPullRequest` is useful when populated, but the source does not prove that a PR opened headlessly with `gh` will populate it automatically. The web client can link a PR after parsing or selecting it, so the external GitHub check remains necessary.

## Authentication and process lifecycle

The local CLI does not need a pairing token or a credential in the timer environment. If its saved credential is missing or invalid, it issues a 30-day bearer session with only `orchestration:read` and `orchestration:operate`, stores it under the local T3 state directory, and reuses it. The observed directories are mode 0700 and the token file is mode 0600. [Local bearer issuance](https://github.com/totalolage/t3code/blob/da15a0498753c9ed75bd1aafceb1bcf91d7d7421/apps/server/src/cli/remote.ts#L520-L598).

This means the timer should run as the same Unix user as T3 Code. Do not copy the token into environment variables, command arguments, Slack, or logs.

The timer should check `systemctl --user is-active t3code.service` before creating work. The server can run headlessly as a user service. The coding provider's CLI authentication also has to survive reboot and be available to that service user. A browser or desktop renderer is not part of the execution path.

## Interfaces not to build against

- Do not launch `codex exec`. That bypasses the user's requirement and T3's thread, worktree, interaction, and history model.
- Do not write the T3 SQLite database. The local CLI explicitly refuses offline mutation.
- Do not synthesize orchestration WebSocket messages. The CLI already wraps the supported HTTP and WebSocket contracts, compatibility checks, authentication, idempotency, reconnection, and sanitized interaction handling.
- Do not automate the browser UI. It adds a brittle renderer dependency to a headless workflow.
- Do not use `t3 remote` for this same-machine loop. It requires separate bootstrap credential management and an explicit host. The top-level local commands exist for this case.
- Do not use Slack as a queue or source of truth. Use the PostHog signal identity for deduplication and a small local job ledger. Use Slack only for notices and human interaction.

These orchestration commands are a supported feature of the managed `totalolage/f8y` fork, not current upstream T3 Code. The pinned upstream command tree lacks them, and upstream's orchestration-v2 work remains an unmerged pull request. Do not replace the fork CLI with upstream `npx t3` and expect this loop to keep working. [Pinned upstream command tree](https://github.com/pingdotgg/t3code/blob/018d7f2775daabd2ef07898af29586915a0b7f67/apps/server/src/bin.ts#L48-L62), [unmerged upstream orchestration pull request](https://github.com/pingdotgg/t3code/pull/2829).

## Live checks and remaining defects

The following checks ran without reading or printing credentials, task messages, or production payloads:

- The service is active and enabled.
- The managed F8Y binary advertises the full local and remote orchestration command trees.
- `t3 session` authenticated locally with exactly `orchestration:read` and `orchestration:operate`.
- `t3 pending` returned valid JSON.
- `t3 create` refused to operate without both confirmation flags.
- A confirmed create against a nonexistent project failed without creating a thread.

Two issues remain:

1. The stale `t3` on `PATH` must be replaced by the verified F8Y standalone CLI before service automation is dependable.
2. On this devbox, `t3 shell` and `t3 snapshot` exited successfully but emitted truncated, invalid JSON for the current large history. Do not use either command in the loop. `create`, `watch`, `pending`, `session`, and targeted `thread` are the narrow operations needed. File a T3 Code bug for the large-output truncation separately.

No live agent thread or pull request was created during this research.
