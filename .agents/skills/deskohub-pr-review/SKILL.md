---
name: deskohub-pr-review
description: Address Deskohub pull-request review feedback, review-raised bugs, regression tests, review-thread replies and resolution, or moving a completed stopping-point PR out of draft.
---

# Deskohub PR review

When fixing a bug raised by review, first add a regression test against the current implementation and confirm that it fails. Do not change production code for hypothetical states that the application cannot produce.

When a planned PR stopping point is ready for user review, publish the PR as ready for review instead of leaving it in draft.

After an addressed fix is pushed and validated, reply to each addressed review thread with a concise summary and mark the thread resolved.

Update this skill when developer feedback changes the repository's review workflow.
