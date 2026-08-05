---
name: deskohub-pr-review
description: Address Deskohub pull-request review feedback, review-raised bugs, regression tests, review-thread replies and resolution, or moving a completed stopping-point PR out of draft.
---

# Deskohub PR review

Before invoking the Codex CLI for a branch review, commit the complete intended
change and review that commit against the target base branch. Use `codex review
--base <base-ref>`; do not use `codex review --uncommitted` for the PR review
loop, and do not depend on GitHub `@codex review` comments, bot reactions, or
their delivery as the completion signal. Commit each subsequent actionable
reviewer fix before rerunning the review against the same base so the reviewer
always evaluates the publishable branch. Iterate until a fresh Codex CLI review
reports no findings.

When fixing a bug raised by review, first add a regression test against the current implementation and confirm that it fails. Do not change production code for hypothetical states that the application cannot produce.

When a planned PR stopping point is ready for user review, publish the PR as ready for review instead of leaving it in draft.

For every PR that introduces or changes UI, attach screenshots of every newly introduced visible UI state to the PR. Capture the exact committed and pushed code, preferably from its immutable preview. Cover states that differ materially in copy, layout, interaction result, or responsive presentation; document non-visible boundary states with tests rather than empty screenshots. Upload ephemeral review screenshots through GitHub rather than committing them to the repository unless they are durable documentation or test fixtures. Use the `gh image` extension for native `user-attachments` when a GitHub browser session is available. In a headless environment, upload synthetic-only screenshots as GitHub Release Assets in the dedicated `totalolage/gitshot-images` repository and embed those URLs with `gh pr comment`. Never use Cloudinary for PR screenshots.

After an addressed fix is pushed and validated, reply to each addressed review thread with a concise summary and mark the thread resolved.

Update this skill when developer feedback changes the repository's review workflow.
