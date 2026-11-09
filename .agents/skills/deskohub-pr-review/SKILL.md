---
name: deskohub-pr-review
description: Pull request, PR review feedback, review threads, code review round, regression fix, UI screenshots, PR screenshot upload, ready for review, mergeable, merge main, branch behind main, PR monitoring.
---

# Deskohub PR review

## Review rounds

- Give an independent read-only reviewer a fixed revision or diff hash, the diff itself, acceptance criteria, changed files, test evidence, and known risks, so the review doesn't depend on running commands. A fixed uncommitted diff is fine.
- Route accepted findings to whoever owns that code, reverify, and return to the same reviewer until it approves. Then run final verification.
- Commits are publishing steps that need user authorization, not a prerequisite for each review round.

## Fixes

- For a bug raised in review, first add a regression test against the current implementation and confirm it fails.
- Don't change production code for states the application can't produce.

## Screenshots

Every PR that introduces or changes UI needs a screenshot of each newly introduced visible state, posted to the PR.

- Capture the exact committed and pushed code, preferably from its immutable preview deployment.
- Cover states that differ in copy, layout, interaction result, or responsive presentation. Cover states that render nothing with tests, not empty screenshots.
- Upload through GitHub; don't commit screenshots unless they're durable documentation or test fixtures. Never use Cloudinary.
- With a GitHub browser session, use the `gh image` extension for native `user-attachments` uploads. Headless, upload synthetic-only screenshots as release assets in `totalolage/gitshot-images` and embed their URLs with `gh pr comment`.

## Merging main

Each push to a pull request branch starts a full Vercel preview build, so merge `origin/main` into the branch once, as the last step before merging the pull request.

1. Finish development, review, and every other required check on the branch as it stands. A branch behind `main` is fine; GitHub doesn't require it to be up to date.
2. `git fetch origin && git merge origin/main`, then push. Always merge; never rebase or force-push.
3. If the final main merge is clean, with no hand-written conflict resolution, and post-merge CI is green, merge the pull request without another review round. If conflict resolution was needed, re-review the resolved hunks and the code and behavior they touch, then merge once that review passes and CI is green. If CI goes red after the final merge, the pull request returns to development and review.

Merge `main` earlier only to resolve a real conflict or a failure that blocks work in progress. Main moving, a `BEHIND` merge state, and monitoring a pull request are not reasons to merge early. For conflict resolutions in other integration contexts, follow the branch integration guidance in the `deskohub-repository` skill.

## Completion

- At a planned stopping point, mark the PR ready for review instead of leaving it in draft.
- Local verification is a checkpoint, not the finish. Continue through review, commit, push, screenshot evidence from the deployment, thread resolution, required checks, and the final main merge until the PR is mergeable. Stop earlier only when the user pauses the work or a blocker needs their input.
- After a fix is pushed and validated, reply to each addressed thread with a short summary and resolve it.
