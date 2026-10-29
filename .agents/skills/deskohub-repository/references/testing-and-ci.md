# Testing, lint rules, and CI

## Test placement

- Test each behavior at the cheapest layer that has the infrastructure it needs. Put CSS, animation, layout, and focus facts in component or real-browser component tests (`apps/deskohub-workspace/shared/testing/playwright-browser.ts`). Keep E2E for cross-page flows, auth, persistence, payments, integrations, and deployment behavior.
- Assert behavior, not source text, constants, config literals, mock return values, or your own fixtures.
- Put every check in a colocated `*.test.ts` next to the code it covers. Don't add standalone check scripts.
- Put shared test helpers in a small dependency-free leaf package, such as `@deskohub/test-email`, that consumers take as a devDependency. Within Workspace, put them in `*.test-utils.ts` or `*-fixture.ts` modules.
- Test SQL behavior against Postgres in `*.postgres.test.ts` files, not by matching SQL text.
- Replace real-clock waits (retry backoff, sleeps, delays) with Effect `TestClock`, zero-delay schedules, or fake timers. In Workspace, `withInstantSleeps` (`shared/testing/workspace-test-clock.test-utils.ts`) steps a `TestClock` until the effect finishes.
- To prove a concurrent Postgres waiter exists, poll with `waitForAdvisoryLockWaiter` or `waitForPostgresLockWaiter` (`shared/testing/workspace-postgres-lock-waiters.test-utils.ts`) instead of sleeping.
- Keep tests off real network services. Child-process script tests stub HTTP with a `--preload` fixture that replaces `fetch`, as `apps/deskohub-workspace/scripts/production-release.vercel-api-fixture.ts` does, and assert the child's exit code.
- Gate Bun browser tests with `test.skipIf(!(await playwrightChromiumAvailable()))`. It skips locally when Chromium is missing and throws when `CI` is set, so CI never drops browser coverage. Keep each heavy browser suite in its own file so shards can spread them.

## Test email addresses

Tests, fixtures, E2E code, and visual scripts never contain a literal email address. Build recipients with `testEmailAddress(localPart)` from `@deskohub/test-email`, which uses the `EMAIL_TEST_DOMAIN` constant so mail goes to the Console provider. Use `resendSimulatorAddress(outcome)` only when a test needs a real Resend destination. Boardgame Bar is exempt.

`packages/test-email/src/repository-test-email-literals.test.ts` enforces the rule across `apps/`, `packages/`, and `scripts/`. If you add a scanned root or file extension, update the `test` task `inputs` in `packages/test-email/turbo.json`; a test fails until they match.

## Lint guards

- Write convention and import-boundary guards as lint rules, not tests: a `noRestrictedImports` override in the root `biome.json` or a Grit plugin in `lint/`. Add rejecting and permitting cases to `apps/deskohub-workspace/shared/testing/lint-rules.test.ts`.
- Biome replaces a rule's options across matching overrides instead of merging them. Keep `noRestrictedImports` scopes disjoint, and use Grit for an overlapping file set. `noRestrictedImports` also reports dynamic `import()`, so use Grit when only static imports are banned.
- When Grit can't express a guard precisely, write a `*.test.ts` in the package that owns the convention and give that package's `test` task Turbo `inputs` for every path it scans.
- Grit plugins dominate Workspace `lint:biome` CPU. Open each plugin's `file($name, $body)` clause with whole-file text prefilters on tokens every match must contain, and guard expensive per-match scans with a file-level `contains`, as `no-widen-then-assert` does. A prefilter must never narrow what the rule reports. Prove a plugin edit with `apps/deskohub-workspace/scripts/anti-slop.test.ts`, `lint-rules.test.ts`, and an unchanged diagnostic set on the repository.
- In Workspace, `no-useless-alias` rejects `const alias = source` for import, `const`, function, and class bindings. Use the original name, or rename at the boundary with `import { source as alias }` or `export { source as alias }` (route handlers export `{ handler as GET }`). A type annotation (`const alias: T = source`) keeps an intentional widening alias.
- Workspace `lint` includes `lint:knip`, configured in the root `knip.jsonc`. Remove a flagged export, or drop its `export` keyword when the file still uses it, instead of ignoring the finding. Register a module loaded by path as a commented Workspace `entry`. Configuration hints fail the check.

## Subprocesses

Run subprocesses in Workspace code only through `runCommand` or `commandOutput` in `apps/deskohub-workspace/scripts/shared/command.ts`. They run under Bun (through `Bun.spawn`) and under Node, such as Playwright workers (through `node:child_process`); `command.node-fixture.mjs` covers the Node path. The `no-synchronous-subprocess` Grit rule rejects `Bun.spawnSync` and `node:child_process` `*Sync` calls because a Bun 1.4 bug can hang later synchronous spawns in the same test worker. Re-evaluate the rule after upgrading to a Bun release that includes oven-sh/bun#44581.

Settle a subprocess promise before you assert on it. `expect(pending).rejects` and `.resolves` run a nested event-loop tick that can drop the child's pipe events.

## CI

- Workspace CI runs on every pull request. Keep `test-functional` as the fail-closed required check over the test shards, Workspace validation, migration-count validation, and the administration-messages build check.
- A colocated `*.build.test.ts` checks production build output. The Workspace `test` script ignores the pattern; a job runs the build and then the file by path. `validate-administration-messages` is the example ([administration localization](../../deskohub-workspace-administration/references/localization.md#build-output-check)).
- Workspace tests run in four Bun shards, each with its own disposable Postgres. Keep `--parallel=1`, because suites mutate process-wide state. Database suites skip without `WORKSPACE_TEST_DATABASE_URL`, so keep it in the shard job's job-level `env`, where the first step fails the shard if it's empty. Locally, point it at a disposable container of the CI image `ghcr.io/fboulnois/pg_uuidv7:1.7.0`; stock Postgres lacks the `pg_uuidv7` extension that setup needs.
- Bun cuts shards by the per-file durations in `apps/deskohub-workspace/test-timings.json`. One slow file bounds the balance, so split slow test files instead of adding shards. After you add, rename, split, or substantially slow test files, refresh the file from a Workspace CI run of your commit where every shard passed, then commit it:

  ```bash
  bun apps/deskohub-workspace/scripts/refresh-test-timings.ts <run-id>
  ```

  Pull request runs test your branch merged with `main`, so merge `origin/main` and push before that run; the script rejects a run whose recorded files differ from the checkout's. Don't refresh from local runs; they measure a different machine.
- Boardgame Bar tests run in `.github/workflows/boardgame-bar-ci.yml`, path-filtered to the Bar, `packages/**`, and root build inputs.
- Workspace E2E, preview deployments, and preview databases belong to `deskohub-workspace-e2e` and `deskohub-workspace-operations`. A `dhw` or shared administration contract change needs a release-producing commit; see `deskohub-workspace-administration`.
- Watch a run with `timeout <seconds> gh run watch <run-id> --exit-status --interval <seconds>`, or check once with `gh run view`. Don't poll with `sleep`. A local timeout doesn't cancel the remote run.

## GitHub Actions

- Pin every third-party action to a full commit SHA, not an annotated tag object, with a `# vX.Y.Z` comment.
- Set `persist-credentials: false` on checkouts that never push.
- Give each secret, and each GitHub App token's `permission-*` inputs, to the narrowest step or job that uses it.
- Pass `${{ }}` values to `run:` scripts through `env:`.
