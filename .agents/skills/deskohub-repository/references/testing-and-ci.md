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

## Test coverage

`bun run coverage` at the repository root writes Istanbul `coverage/coverage-final.json` for tools such as visual-crap (`--root <repo> --source <dir> --coverage coverage/coverage-final.json`). It runs `turbo run test --force --continue` with `@deskohub/test-coverage`'s preload in `BUN_OPTIONS`, so the preload loads before any package preload. Arguments go to Turbo, for example `bun run coverage --filter=@deskohub/dotypos`.

- The report has one entry per authored source file: tracked or untracked-but-not-ignored `.ts`, `.tsx`, `.js`, `.jsx`, and `.mjs`/`.cjs` variants under `apps/`, `packages/`, and `scripts/`, excluding `*.test.*`, `*.spec.*`, `*.pw.*`, declarations, and the coverage package. Files no test loads appear with zero counts. Gitignored generated code stays out. Keys are absolute paths.
- It measures code that runs in Bun test processes and in Bun processes those tests spawn (they inherit `NODE_ENV=test`). Code bundled into Playwright browser pages, functions sent to a page as source text, and Playwright E2E runs aren't measured; instrumented counters do nothing outside the module that defines them. Code run by `afterAll` hooks registered in a package preload isn't counted either, because those hooks run after the coverage dump.
- For complete numbers, set `WORKSPACE_TEST_DATABASE_URL` (see CI below) and install Playwright Chromium. Otherwise database and browser suites skip and their code reads as unexecuted. Don't export `NODE_ENV=test` in your shell, or build steps such as client generation report coverage too.
- Failed tests still produce a report, but the command exits non-zero and says the report covers only the tests that ran. Stack traces from instrumented files show shifted line numbers, so debug a failure by rerunning the file without coverage.
- Instrumented code is cached under `coverage/istanbul/cache`, keyed by path, content, and instrumenter version. Delete the directory to reclaim space.
- `packages/test-coverage/src/coverage-collection.test.ts` runs real `bun test` processes over a fixture. Extend it when you change collection.
- Next to the report, `coverage/coverage-sources.json` records the commit, the test scope (complete, or partial for a `--filter` run), the test exit code, and each source file's SHA-256. A file edited while the tests ran gets no hash.

### CRAP scores

Business functions must score below 10 on CRAP (`cyclomatic² × (1 − coverage)³ + cyclomatic`, from Fallow's `health` analysis with the Istanbul report). Even at full coverage the score equals the cyclomatic complexity, so a function with 10 or more branches fails until it is split.

- `bun run crap index` scores every business function against `coverage/coverage-final.json` and writes `coverage/crap-index.json` and `coverage/crap-index.tsv` with each function scoring 10 or more. Run `bun run coverage` first; the index says when that run was partial or had failing tests. It counts the evidence behind every business function's score and lists the unmeasured ones in `crap-index.json` (`unmeasured`), so a clean index also shows whether every function was measured.
- `bun run crap <path> [<line>|<name>] [--test <test path>]...` prints one file's scores, or one function's. With `--test` it first runs only those test files (one package's) with coverage, so the score describes the current source, but the coverage is a lower bound. It exits 1 when a printed function scores 10 or more or isn't measured.
- Each score's evidence is `measured` (Istanbul counts for the file's current content), `stale` (the file changed since the coverage run), or `estimated` (Fallow's static guess where the report has no counts). Only `measured` scores count.
- Business code excludes tests and their helpers (including `*.browser-harness.*` page entries and `fixtures` modules), `e2e/`, `testing/`, `scripts/`, generated code, build configuration, and the test tooling packages; `packages/test-coverage/src/crap-scores.ts` holds the list.
- Lower a score by splitting a function along its real responsibilities or by testing untested behavior. Don't suppress Fallow, widen the exclusions, or add tests that execute code without asserting its behavior.

## Test email addresses

Tests, fixtures, E2E code, and visual scripts never contain a literal email address. Build recipients with `testEmailAddress(localPart)` from `@deskohub/test-email`, which uses the `EMAIL_TEST_DOMAIN` constant so mail goes to the Console provider. Use `resendSimulatorAddress(outcome)` only when a test needs a real Resend destination. Boardgame Bar is exempt.

`packages/test-email/src/test-email-literals.repository-wide.test.ts` enforces the rule across `apps/`, `packages/`, and `scripts/`. It is a repository-wide test, so Workspace validation runs it uncached on every pull request (see below).

## Lint guards

- Write convention and import-boundary guards as lint rules, not tests: a `noRestrictedImports` override in the root `biome.json` or a Grit plugin in `lint/`. Add rejecting and permitting cases to `apps/deskohub-workspace/shared/testing/lint-rules.test.ts`.
- Biome replaces a rule's options across matching overrides instead of merging them. Keep `noRestrictedImports` scopes disjoint, and use Grit for an overlapping file set. `noRestrictedImports` also reports dynamic `import()`, so use Grit when only static imports are banned.
- When Grit can't express a guard precisely, write a `*.test.ts` in the package that owns the convention and give that package's `test` task Turbo `inputs` for every path it scans. A guard that scans files across the repository is a `*.repository-wide.test.ts` instead (see Workspace CI).
- Grit plugins dominate Workspace `lint:biome` CPU. Open each plugin's `file($name, $body)` clause with whole-file text prefilters on tokens every match must contain, and guard expensive per-match scans with a file-level `contains`, as `no-widen-then-assert` does. A prefilter must never narrow what the rule reports. Prove a plugin edit with `apps/deskohub-workspace/scripts/anti-slop.test.ts`, `lint-rules.test.ts`, and an unchanged diagnostic set on the repository.
- In Workspace, `no-useless-alias` rejects `const alias = source` for import, `const`, function, and class bindings. Use the original name, or rename at the boundary with `import { source as alias }` or `export { source as alias }` (route handlers export `{ handler as GET }`). A type annotation (`const alias: T = source`) keeps an intentional widening alias.
- Workspace `lint` includes `lint:knip`, configured in the root `knip.jsonc`. Remove a flagged export, or drop its `export` keyword when the file still uses it, instead of ignoring the finding. Register a module loaded by path as a commented Workspace `entry`. Configuration hints fail the check.

## Subprocesses

Run subprocesses in Workspace code only through `runCommand` or `commandOutput` in `apps/deskohub-workspace/scripts/shared/command.ts`. They run under Bun (through `Bun.spawn`) and under Node, such as Playwright workers (through `node:child_process`); `command.node-fixture.mjs` covers the Node path. The `no-synchronous-subprocess` Grit rule rejects `Bun.spawnSync` and `node:child_process` `*Sync` calls because a Bun 1.4 bug can hang later synchronous spawns in the same test worker. Re-evaluate the rule after upgrading to a Bun release that includes oven-sh/bun#44581.

Settle a subprocess promise before you assert on it. `expect(pending).rejects` and `.resolves` run a nested event-loop tick that can drop the child's pipe events.

## CI

- Workspace CI runs on every pull request. Keep `test-functional` as the fail-closed required check over the shard selection, the test shards, Workspace validation, migration-count validation, and the administration-messages build check.
- `select-workspace-shards` runs the shards only when the pull request affects a shard task. With `futureFlags.affectedUsingTaskInputs` in the root `turbo.json`, `turbo run --affected` matches the changed files against task inputs (the shard tasks' own, those of every task they depend on, and their `$TURBO_ROOT$` globs), not against whole packages. The base is the first parent of the pull request's merge commit. A turbo.json, lockfile, or `globalDependencies` change affects every task, and an unresolvable base makes Turbo select every task. `test-functional` accepts skipped shards only when the selection succeeded and reported `affected=false`. A Mobile-only change skips the shards unless it touches Mobile's `app.json`, `public/`, or `package.json` (shard inputs), because the shards don't depend on Mobile's tests (below). Skipped runs upload no timing artifacts, so refresh timings only from a run whose shards ran. To preview the selection locally, run `TURBO_SCM_BASE=origin/main bun turbo run test:shard-1 --affected --dry-run=json` and look for `deskohub-workspace#test:shard-1` in `.tasks`.
- A `*.repository-wide.test.ts` reads files across the repository, such as every test file (`no-source-string-tests.repository-wide.test.ts`) or every scanned module (the test-email check). No package task may cache one: the Workspace and test-email `test` scripts ignore the pattern, and `validate-workspace` runs every tracked one by path, uncached, on every pull request. That keeps repository-wide inputs out of the shards' cache keys and selection.
- A colocated `*.build.test.ts` checks production build output. The Workspace `test` script ignores the pattern; a job runs the build and then the file by path. `validate-administration-messages` is the example ([administration localization](../../deskohub-workspace-administration/references/localization.md#build-output-check)).
- Workspace tests run in four Bun shards, each with its own disposable Postgres. Keep `--parallel=1`, because suites mutate process-wide state. Database suites skip without `WORKSPACE_TEST_DATABASE_URL`, so keep it in the shard job's job-level `env`, where the first step fails the shard if it's empty. Locally, point it at a disposable container of the CI image `ghcr.io/fboulnois/pg_uuidv7:1.7.0`; stock Postgres lacks the `pg_uuidv7` extension that setup needs.
- Each shard is the cached Turbo task `deskohub-workspace#test:shard-<n>`, run by `apps/deskohub-workspace/scripts/test-shard.ts`. CI runs one per matrix job. To run all four locally the same way, use `bun run --cwd apps/deskohub-workspace test:local-shards`. It starts one throwaway CI-image container per shard on a dynamic loopback port and sets `CI=true` and `TZ=UTC`, as the CI job does. It also drops every other variable that isn't Turbo's own, then runs the four tasks. A shard computed on either side replays from the remote cache on the other once this machine is logged in to it. Extra arguments go to `turbo run`, for example `--dry=json`, `--summarize`, or `--force`. The unsharded `test` task stays uncached.
- A shard's cache key must cover everything that can change its result. Package files, `dependsOn` hashes, `CI`, and `TZ` are hashed. Internal packages reach the hash through `test:dependencies`, a script-less Workspace task that depends on the `test` task of every internal package the Workspace lists except Mobile; `test-shard.test.ts` keeps it equal to `package.json`. The Workspace lists Mobile only so Mobile changes redeploy it (it serves the web export at `/app/`) and no shard test imports Mobile, so Workspace validation runs Mobile's tests instead: Mobile CI is path-filtered and not required. The shard tasks' `$TURBO_ROOT$` inputs cover files outside the package that tests read: workflows (which also pin the Postgres image), root and workspace manifests, Biome and Grit config, `tsconfig.json`, patches, Mobile's `app.json` and `public/`, and `.gitignore` files. When a Workspace test starts reading another file outside `apps/deskohub-workspace`, add it to the inputs of all four shard tasks in `apps/deskohub-workspace/turbo.json`. Otherwise the cache replays a result computed without it. A test that needs another environment variable needs it hashed in the shard tasks' `env` and set identically by both launchers, not passed through.
- Bun cuts shards by the per-file durations in `apps/deskohub-workspace/test-timings.json`. One slow file bounds the balance, so split slow test files instead of adding shards. After you add, rename, split, or substantially slow test files, refresh the file from a Workspace CI run of your commit where every shard passed, then commit it:

  ```bash
  bun apps/deskohub-workspace/scripts/refresh-test-timings.ts <run-id>
  ```

  Pull request runs test your branch merged with `main`, so merge `origin/main` and push before that run; the script rejects a run whose recorded files differ from the checkout's. Each shard records into `test-timings.shard-<n>.json`, a task output that the CI artifact uploads. A shard replayed from the cache restores the recording of the machine that first ran it, which can be a developer machine. That's accepted for balancing, but prefer a run whose shard logs show `cache miss`. Don't refresh from local runs directly.
- Boardgame Bar tests run in `.github/workflows/boardgame-bar-ci.yml`, path-filtered to the Bar, `packages/**`, and root build inputs.
- Workspace E2E, preview deployments, and preview databases belong to `deskohub-workspace-e2e` and `deskohub-workspace-operations`. A `dhw` or shared administration contract change needs a release-producing commit; see `deskohub-workspace-administration`.
- Watch a run with `timeout <seconds> gh run watch <run-id> --exit-status --interval <seconds>`, or check once with `gh run view`. Don't poll with `sleep`. A local timeout doesn't cancel the remote run.

## GitHub Actions

- Pin every third-party action to a full commit SHA, not an annotated tag object, with a `# vX.Y.Z` comment.
- Set `persist-credentials: false` on checkouts that never push.
- Give each secret, and each GitHub App token's `permission-*` inputs, to the narrowest step or job that uses it.
- Pass `${{ }}` values to `run:` scripts through `env:`.
