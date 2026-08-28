# Autonomous PR auto-merge boundary

> **Status: risk research, not an MVP blocker.** The MVP uses the existing GitHub identity and checks, and the worker prompt decides whether a small stable PR may use GitHub auto-merge. The stronger independent enforcement below is deferred until the MVP demonstrates that it is useful. See [the Wayfinder map](https://github.com/totalolage/deskohub-site/issues/288).

Research date: 2026-08-28. Repository: `totalolage/deskohub-site`. The live settings below can change, so rerun the audit before using this note to change merge policy.

## Decision

T3 Code must not enable or perform auto-merge for its own pull requests in v1.

The deterministic policy is deliberately dull:

```text
if pull_request.created_by == t3code_agent:
    auto_merge = denied
```

T3 Code may open a draft PR, update it, run checks, address review feedback, and mark it ready. It must stop there. A human may merge it or explicitly enable GitHub auto-merge after reviewing the current head commit. The existing Release Please auto-merge is a separate release workflow and should remain outside the agent loop.

There is no useful production-code allowlist that current enforcement proves safe. A Markdown-only or test-only allowlist would be low risk, but it would not fix PostHog incidents. Calling that a self-driving fix path would be misleading.

## The fact this decision depends on

GitHub does not currently enforce a human or independent policy decision between an internally authored PR and `main`.

This reached blast-radius proof level 4. A fail-loud audit queried the live repository and asserted all of these facts together:

```text
PASS: live GitHub settings have strict checks and conversation resolution,
but zero approvals, no CODEOWNERS, no rulesets, and no admin enforcement.
```

The audit used:

```bash
gh api repos/totalolage/deskohub-site/branches/main/protection
gh api repos/totalolage/deskohub-site/rulesets
find . -type f -name CODEOWNERS -not -path './node_modules/*'
```

The current devbox GitHub identity reports repository `admin: true`. I did not test a bypass because that would mutate the repository. The bypass conclusion therefore stops at level 2: the live protection response says `enforce_admins.enabled: false`, and GitHub documents that branch protection does not apply to administrators by default. [GitHub protected branch behavior](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#do-not-allow-bypassing-the-above-settings)

GitHub auto-merge only waits for configured merge requirements. It does not add review or test requirements of its own. [GitHub auto-merge documentation](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/incorporating-changes-from-a-pull-request/automatically-merging-a-pull-request)

## What GitHub enforces today

The live `main` branch protection response has these controls:

| Control | Current value | What it proves |
| --- | --- | --- |
| Pull request required | Enabled with `required_approving_review_count: 0` | Changes normally travel through a PR, but no approval is required. |
| Required checks | `Vercel Preview Comments`, `Vercel – deskohub-workspace-site`, `Vercel – deskohub-portal`, `test-functional`, `Workspace E2E` | Those five contexts must report an accepted result from their pinned GitHub Apps. |
| Strict checks | Enabled | The PR must be current with `main` before merge. |
| Conversation resolution | Enabled | Existing review conversations must be resolved. No conversation is also sufficient. |
| Force push and deletion | Disabled | Ordinary writers cannot rewrite or delete `main`. |
| Admin enforcement | Disabled | Administrators can bypass protection. |
| Required code-owner review | Disabled | No path has an owner approval gate. There is also no `CODEOWNERS` file. |
| Last-push approval | Disabled | A push after any informal review does not require a fresh approval. |
| Signed commits | Disabled | Commit signing is not a merge condition. |
| Merge queue | Absent | GitHub does not retest a merge-group commit. Strict status checks still require an up-to-date PR head. |
| Repository rulesets | None | No second policy layer restricts paths, actors, workflows, or bypass. |

Required checks accept successful, skipped, or neutral conclusions. GitHub also allows a required check to be pinned to the App that reports it, which this repository does. [GitHub required status checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)

The repository allows auto-merge and only the merge-commit strategy. Recent history shows auto-merge use, but not an autonomous-agent policy. Among the 100 most recently merged PRs inspected, 21 had auto-merge enabled. Thirteen were Release Please PRs enabled by `deskohub-release-bot`; eight were enabled by the human maintainer. The human-enabled set includes a migration-only change, broad checkout changes, root dependency changes, and CLI release work. It is discretionary precedent, not a path classifier. Examples include [linearizing a CLI migration](https://github.com/totalolage/deskohub-site/pull/187), [adding discount-code checkout](https://github.com/totalolage/deskohub-site/pull/231), [changing revenue telemetry and root inputs](https://github.com/totalolage/deskohub-site/pull/269), and [adding force-cancel behavior](https://github.com/totalolage/deskohub-site/pull/286).

Release Please is the one automated precedent. Its workflow enables merge-commit auto-merge on the release PR returned by Release Please. [DHW release workflow](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/dhw-release.yml#L80-L96) This is a known producer with a narrow purpose. It does not prove that agent-written fixes are safe to merge.

## What the required checks actually cover

`test-functional` is the broadest required repository-owned check. It:

- installs with `bun install --frozen-lockfile`;
- regenerates Workspace database migrations and fails on a migration diff;
- rebuilds the Workspace E2E allocation action and fails on a bundle diff;
- runs root `turbo typecheck`;
- runs the Workspace application test task.

[Workspace CI source](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/workspace-tests.yml#L33-L67)

`Workspace E2E` has valuable exact-commit checks. It accepts an immutable Vercel deployment only when it matches the open internal PR head SHA, excludes drafts and Dependabot, migrates the matching non-primary Neon preview branch, and publishes a commit status for that SHA. [Target validation](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/workspace-e2e.yml#L47-L155), [preview migration](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/workspace-e2e.yml#L157-L249), [final status](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/workspace-e2e.yml#L496-L535)

Those checks do not establish a safe general allowlist:

- Root lint is not required.
- Tests for every application and package are not required. The required test command selects the Workspace application.
- No required Boardgame Bar deployment context exists. A live `gh pr checks 275` audit for [a Boardgame Bar fix](https://github.com/totalolage/deskohub-site/pull/275) showed the two required Vercel application contexts for Workspace and Portal, Workspace E2E, and Workspace CI. It showed no Boardgame Bar build or test context. This is proof level 4 against a real PR.
- DHW CI runs for matching paths, but none of its release-intent, test, or native binary jobs is in branch protection. [DHW CI path and jobs](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/dhw-ci.yml#L8-L21) A live check audit on [force-cancel behavior](https://github.com/totalolage/deskohub-site/pull/286) confirmed those jobs ran, but the protection API confirmed they are not merge requirements.
- The migration-count job, which rejects more than one new SQL migration, runs on PRs but is not required. [Migration-count job](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/workspace-tests.yml#L15-L31), [validator](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/apps/deskohub-workspace/scripts/validate-migration-count.ts#L15-L39)
- Generated Dotypos and Nexi clients are regenerated by parts of the Turbo graph, but CI does not require a clean diff for them. A generation command can make typechecking pass while leaving the committed generated source stale.
- `bun.lock` consistency is checked by the frozen install. Dependency risk is not. The live repository settings report dependency security updates, secret scanning, and push protection disabled.
- Repository Actions allow all actions and do not require SHA pins. Several required workflows use moving action tags. GitHub recommends full commit pins because tags can move. [GitHub Actions hardening](https://docs.github.com/en/code-security/tutorials/secure-your-organization/protect-against-threats#harden-your-github-actions-workflows)

GitHub documents that a required workflow skipped by path or branch filtering remains pending and blocks merge. [Workflow trigger behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#using-filters-to-target-specific-branches-or-tags-for-push-events) That protection only matters for contexts listed as required. It does not make the non-required DHW or migration-count jobs merge gates.

## Paths that must remain human-gated

These are immediate deny categories for any later experiment. They are not the complement of a safe allowlist.

- `.github/**`, workflow actions, and CI scripts. A PR can change the checks that judge it.
- `package.json`, `bun.lock`, Turbo configuration, TypeScript configuration, lint configuration, and application build configuration. These alter the dependency or validation graph.
- Any `.env*` file or environment schema. The repository currently tracks application environment files, and live secret scanning and push protection are disabled. Do not inspect or quote their contents in agent output.
- Workspace schema, migrations, Drizzle configuration, and database scripts. A merge to `main` runs the production sequence without an environment approval: staged production build, production migration, then promotion. [Production deployment workflow](https://github.com/totalolage/deskohub-site/blob/a2132bf52b97ef659242603c6726bf8c7143c387/.github/workflows/deploy-workspace-production.yml#L47-L68) Preview migration success does not prove compatibility while old and new production functions overlap.
- `apps/dhw/**`, `packages/workspace-admin-api/**`, release manifests, and Release Please configuration. A merge can produce a release PR and later an immutable CLI release.
- Checked-in generated clients, feature-flag contracts, migration snapshots, and the bundled E2E action. Generator freshness is unevenly enforced.
- Authentication, authorization, admin, checkout, payment, accounting, invoice, webhook, cron, API route, proxy, instrumentation, and external-provider code. These paths can spend money, expose data, mutate provider state, or change trust boundaries.
- Deletions, renames, new dependencies, and changes spanning applications or shared packages. A file-count or line-count limit does not make these safe.

The Workspace production environment and the E2E environment currently report no deployment reviewers or wait rules. A successful merge can therefore proceed into production automation without a human deployment stop.

## Why history does not justify a wider boundary

The latest 100 merged PRs cover only 2026-08-05 through 2026-08-28. That is too short and too dependent on one maintainer's judgement to estimate autonomous merge risk.

The latest explicit revert commits are older. [The homepage map PR](https://github.com/totalolage/deskohub-site/pull/5) reverted a visual parallax change on its branch before merge. The initial handoff PRs contain repeated reversions of a test-email button. No merged PR in the inspected recent set had a `Revert` title. This says little about safety. It may mean defects were fixed forward, reverted within the original branch, or never recorded with that naming convention.

## What remains unproven

- No live bypass attempt was made. Admin bypass is supported by GitHub's documented behavior and current settings, but was not exercised.
- No check demonstrates that an agent fix preserves business behavior outside the Workspace E2E catalog.
- No deterministic rule connects a PostHog error to a semantically low-risk source path. A one-line change in payment or authentication code can be more dangerous than a large component refactor.
- No independent actor verifies that the current PR head matches the revision T3 Code reviewed and tested.
- No policy prevents alert text, logs, issue comments, or changed repository files from steering the agent toward workflow, credential, or policy changes.
- No required check evaluates migration compatibility across the old deployment and new deployment. Generation and preview migration test a different fact.
- No recovery evidence establishes a maximum time to detect and revert a bad autonomous merge.

GitHub warns that workflow code and PR metadata are untrusted inputs, and that workflows with secrets need privilege separation. [GitHub Actions secure-use reference](https://docs.github.com/en/actions/reference/security/secure-use) Internal branch PRs deserve extra care because their workflow runs can receive secrets that fork PRs do not. [GitHub compromised-runner guidance](https://docs.github.com/en/actions/concepts/security/compromised-runners#potential-impact-of-a-compromised-runner)

## Smallest future step if human-authorized auto-merge is wanted

Do not build a path classifier first. Make the existing human decision enforceable:

1. Run T3 Code through a distinct GitHub App that has no administrator role and no branch-protection bypass. Do not use the current admin user's token.
2. Require one approval from someone other than the App after the latest push. Turn on stale-review dismissal or last-push approval.
3. Apply branch protection to administrators and bypass-capable roles.
4. Let the human enable GitHub auto-merge after approving the current head. GitHub can then wait for the existing required checks.

That is still a closed engineering loop through "ready to merge," with one explicit release decision. It is the smallest boundary current evidence supports.

Fully autonomous merge should remain a later decision. Before revisiting it, add an independent required policy status pinned to a separate GitHub App, close the CI gaps above, protect production deployments, and prove a useful allowlist against real incident-fix history. GitHub rulesets can enforce required checks, required workflows, path restrictions, and explicit bypass actors, but none exists in this repository today. [GitHub ruleset capabilities](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)
