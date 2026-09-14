---
name: deskohub-pr-review
description: Pull request review feedback, regression fixes, thread resolution, and completion.
---

# Deskohub PR review

In OpenCode, use the native read-only `review` subagent, following the active
`orchestrator` and `review` agent instructions. Supply a fixed base/artifact
revision or diff hash, the actual diff, acceptance criteria, changed files, test
evidence, known risks, and applicable child review coverage because the reviewer
cannot run shell commands. Route accepted findings to their implementation
owners, reverify, and resume the same reviewer until it returns `APPROVED`, then
perform final verification. A fixed uncommitted diff is valid. Treat commits as
separate publishing steps subject to user authorization, not prerequisites for
each review. Review units may contain multiple execution contributions; impose
neither a root-only rule nor a per-worker review requirement.

When fixing a bug raised by review, first add a regression test against the current implementation and confirm that it fails. Do not change production code for hypothetical states that the application cannot produce.

When a planned PR stopping point is ready for user review, publish the PR as ready for review instead of leaving it in draft.

For PR feedback work, local verification is an intermediate checkpoint. Continue through review, commit, push, deployed screenshot evidence, thread resolution, and required checks until the PR is mergeable. Stop earlier only for an explicit user pause or a concrete blocker that requires their input.

For every PR that introduces or changes UI, attach screenshots of every newly introduced visible UI state to the PR. Capture the exact committed and pushed code, preferably from its immutable preview. Cover states that differ materially in copy, layout, interaction result, or responsive presentation; document non-visible boundary states with tests rather than empty screenshots. Upload ephemeral review screenshots through GitHub rather than committing them to the repository unless they are durable documentation or test fixtures. Use the `gh image` extension for native `user-attachments` when a GitHub browser session is available. In a headless environment, upload synthetic-only screenshots as GitHub Release Assets in the dedicated `totalolage/gitshot-images` repository and embed those URLs with `gh pr comment`. Never use Cloudinary for PR screenshots.

After an addressed fix is pushed and validated, reply to each addressed review thread with a concise summary and mark the thread resolved.

Update this skill when developer feedback changes the repository's review workflow.
