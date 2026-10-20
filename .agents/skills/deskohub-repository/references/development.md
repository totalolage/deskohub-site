# Repository development

## Commands

Run from the repository root. Check the target package's `package.json` first: packages don't all expose the same scripts.

```bash
bun install
bun turbo dev --filter=<package-name>
bun turbo lint --filter=<package-name>
bun turbo typecheck --filter=<package-name>
bun turbo test --filter=<package-name>
bun turbo build --filter=<package-name>
```

- Both Next.js apps use the same default dev port. Set `PORT` when you run them together.
- Turbo runs tasks in strict env mode, which drops `TMPDIR`. To give tests a different temporary directory, run Turbo with `--env-mode=loose`.
- Before you run Workspace database or E2E tasks against a shared or hosted environment, load `deskohub-workspace-operations` or `deskohub-workspace-e2e`.

## Turbo task graph

- Compose prerequisites with Turbo `dependsOn`. Keep package scripts as leaf commands, with no shell chains or script-to-script calls.
- Give every package with checked-in source a `lint` task so the root lint graph covers it.
- When a package `turbo.json` overrides `dependsOn` for a root task that depends on `^<task>`, start the list with `$TURBO_EXTENDS$`. Without it, internal-package changes replay a stale cached result.
- Declare files outside the package that a task reads, such as root scripts and patches, as `$TURBO_ROOT$/...` inputs.
- Keep cached and validation tasks off uncached tasks that fetch live remote data and rewrite tracked files.
- Workspace `build` must keep the `NEXT_PUBLIC_VERCEL_*` variables in its hash. Skew Protection needs them, so a cache miss between deployments is expected. Only `i18n:compile`, whose inputs are just messages and Inlang settings, excludes them.

## Workspace builds

- Vercel Workspace builds use the standard 4-core, 8 GB machine. Vercel drops build caches over 1.5 GB.
- `next build` holds 4–5 GB of Turbopack state until a few seconds after compiling, then drops to about 0.5 GB. Whatever starts at that boundary stacks on top of it. A probe that logs per-process RSS from the `build` script, on a throwaway branch, shows where memory goes.
- The Workspace `build` script runs `next typegen`, then the native `tsc --noEmit`, then `next build`, and `next.config.mjs` sets `typescript.ignoreBuildErrors: true`. Next's own check runs the TS6 compiler in a worker that needs about 3–3.5 GB beside `next build`. In October 2026 it hung until Vercel's 45-minute timeout or got OOM-killed (exit 137) on main and many branches. The native check takes about 15 s on Vercel and exits before `next build` starts. The build runs its own type check so every deployment validates app and route types before `next build` compiles, independent of CI.
- `experimental.cpus: 1` runs page-data collection and static generation in one worker, which starts at up to 1 GB. At the compile boundary three workers left 0.8 GB free and two left 0.2 GB; one leaves about 2 GB. Static generation takes about 47 s either way, because a worker prerenders up to 8 pages at once.
- `experimental.turbopackFileSystemCacheForBuild: false` disables Turbopack's build filesystem cache, which is on by default in Next 16.4. It held about 5 GB more and pushed Vercel's build cache past 1.5 GB.
- Don't re-enable Next's build-time type check or the Turbopack build cache, or raise `experimental.cpus`, without re-measuring a cold build on the 8 GB machine.

## Toolchain

- Bun is pinned to 1.4.2 in `packageManager`, `@types/bun`, and every workflow's `bun-version`. Change them together and never go below 1.4.0. Bun 1.3 writes a self-referential `@typescript/old` record into `bun.lock`, and `bun install --force` keeps a bad record, so regenerate the lock only with Bun 1.4 or later.
- `@typescript/native` (`npm:typescript@7.x`) provides `tsc`. The root `prepare` script patches it with `effect-tsgo`. `typescript` (`npm:@typescript/typescript6`) provides the TS6 API for typescript-eslint and Next.js and the `tsc6` CLI. Never add a plain `typescript` dependency or another package that provides a `tsc` bin.
- Next apps set `experimental.useTypeScriptCli: false` because the TS6 wrapper has no `tsc` bin. Next type-checks Boardgame Bar builds through its TS6 API. The Workspace build script and `bun turbo typecheck` run the patched native compiler.
- Workspace test files aren't type-checked by design: `apps/deskohub-workspace/tsconfig.json` excludes `**/*.test.ts` and `**/*.test.tsx`. Don't add a test tsconfig or test typecheck task, and don't report this as a finding.

## Next.js

- Upgrade `next` and every `@next/*` package together: the app tilde ranges, the exact `@next/playwright` pin, and the `next` peer ranges in `packages/i18n` and `packages/next-effect`. Regenerate `bun.lock` with one `bun install`, then confirm `bun install --frozen-lockfile`.
- Keep strict route matching; don't set `deprecated.looseRouteMatching`. Give every sibling parallel-route slot a matching page or `default.tsx` for each URL. `next build` fails on a gap, and `next dev` shows a blocking overlay. Fixtures that copy part of the route tree must copy complete routes, as `e2e/account-legal-fixture.ts` does with the account `@modal` slot.
- Parse RSC flight rows and resolve their references instead of asserting raw rows. The row format changes between minor versions.

## Patched dependencies

The root `patchedDependencies` patch `effect`, `@effect/sql-pg`, `@effect/openapi-generator`, and `@better-auth/oauth-provider` from `patches/`. An upgrade changes the patch key, so re-apply or drop the patch when you upgrade one of them. For `effect`, `@effect/sql-pg`, and `@better-auth/oauth-provider`, rerun the guard tests:

- `effect`: a fiber resumed by a callback continues in the async context it suspended in. Without it, Next.js request APIs (`revalidatePath`, `revalidateTag`, `after`, `headers`, `cookies`) can target another request. Keep request APIs inside Effects. Guards: `request async context` in `packages/next-effect/src/index.test.ts` and `apps/deskohub-workspace/db/database-async-context.test.ts`.
- `@effect/sql-pg`: an interrupted statement, or one that fails without a server SQLSTATE, destroys its pooled connection instead of calling `pg_cancel_backend`, so the connection never returns to the pool mid-query or mid-transaction. Guard: `Database pool cancellation against real Postgres` in `apps/deskohub-workspace/db/database-pool-cancellation.test.ts`.
- `@better-auth/oauth-provider`: the boot-time MCP resource seed reads the whole error cause chain, so a missing `auth.oauth_resource` table (Drizzle keeps the Postgres message in `cause`) defers the seed instead of failing every auth request of an instance that starts before its migration. Drop the patch once upstream checks the cause. Guard: `customer agent resource seed before the OAuth migration` in `apps/deskohub-workspace/features/account/backend/auth/customer-agent-resource-seed.postgres.test.ts`. The same patch makes `/oauth2/delete-consent` revoke the client's access and refresh tokens for that user (upstream issue [better-auth#10386](https://github.com/better-auth/better-auth/issues/10386), change from open PR [better-auth#11056](https://github.com/better-auth/better-auth/pull/11056)): `deleteConsentEndpoint` calls `invalidateRefreshFamily`, which now deletes every access and refresh token of the client and user. Without it, a disconnected assistant keeps working until its tokens expire. Drop that part once upstream ships it. Guard: `disconnects one assistant: its tokens stop working and other grants keep theirs` in `customer-agent-oauth-flow.postgres.test.ts` beside it. The patch also binds each authorization code to the consent that authorized it (upstream issue [better-auth#11318](https://github.com/better-auth/better-auth/issues/11318), change from open PR [better-auth#11345](https://github.com/better-auth/better-auth/pull/11345)): `authorizeEndpoint` stores `consentId` in the code's verification value, and `checkVerificationValue` answers `invalid_grant` when that consent is gone or no longer covers the code's scopes and resources. Without it, a code issued before a disconnect still buys tokens. Codes of `skipConsent` clients carry no consent and are unaffected. Drop that part once upstream ships it. Guard: `disconnects one assistant: its codes from before the disconnect no longer exchange, other codes do` in the same test file.

## Generated assets

- After changing an app's message JSON, run `bun turbo i18n:compile --filter=<package-name>` before trusting generated copy or copy-sensitive tests.
- Regenerate OpenAPI clients with the package's `generate` task from its checked-in contract. Don't edit `src/generated/`.
- The Games and Igloohome clients are gitignored. Run their tests through `bun turbo test --filter=<package-name>`, or run `bun run generate` in the package once before a bare `bun test`.
- Generate Workspace migrations and metadata with `bun turbo db:generate --filter=deskohub-workspace`. Never hand-write the Drizzle journal or snapshots.

## Branch integration

When combining branches needs conflict resolution, inspect each conflict and decide the exact combined behavior before you resolve it. Keep lockfile reconciliation and generated-file cleanup separate from other changes. Verify the combined result and re-review the areas the resolution touches. For the final main merge before a PR merges, follow [Merging main](../../deskohub-pr-review/SKILL.md#merging-main).

## Environment files

- Workspace and Boardgame Bar each own a `.env.example`. Copy it to the app-local ignored env file. Keep developer-only values in ignored local overrides.
- Keep Vercel-synced values in the matching ignored `.env.<environment>.local`, not `.env.local`.
- Never commit real env files or print credential values. Load `deskohub-workspace-operations` before you use production integration access.
