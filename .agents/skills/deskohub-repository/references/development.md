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

- Vercel Workspace builds use the standard 4-core, 8 GB machine. Vercel drops build caches over 1.5 GB; a cold build without cache previously ran out of memory during Next's `Running TypeScript` step.
- Keep these two settings together: `experimental.turbopackFileSystemCacheForBuild: false` in `apps/deskohub-workspace/next.config.mjs` disables Turbopack's build filesystem cache, which is on by default in Next 16.4 and held about 5 GB in the main process during type-checking; `NODE_OPTIONS=--max-old-space-size=4096` in the Workspace `build` script raises the heap limit for Next's TypeScript worker, which uses about 2.6 GB on a cold build versus Node's roughly 2.2 GB default.
- This combination passed a cold Vercel build in about 3m46s with a 623 MB build cache. The `build` script's `NODE_OPTIONS` assignment replaces any `NODE_OPTIONS` set in Vercel, so add extra flags in the script. The heap limit does not cap total RSS.
- Don't re-enable Turbopack's build cache or remove the heap flag without re-measuring a cold build on the 8 GB machine.

## Toolchain

- Bun is pinned to 1.4.2 in `packageManager`, `@types/bun`, and every workflow's `bun-version`. Change them together and never go below 1.4.0. Bun 1.3 writes a self-referential `@typescript/old` record into `bun.lock`, and `bun install --force` keeps a bad record, so regenerate the lock only with Bun 1.4 or later.
- `@typescript/native` (`npm:typescript@7.x`) provides `tsc`. The root `prepare` script patches it with `effect-tsgo`. `typescript` (`npm:@typescript/typescript6`) provides the TS6 API for typescript-eslint and Next.js and the `tsc6` CLI. Never add a plain `typescript` dependency or another package that provides a `tsc` bin.
- Next apps set `experimental.useTypeScriptCli: false` because the TS6 wrapper has no `tsc` bin. Next type-checks builds through its TS6 API, and `bun turbo typecheck` runs the patched native compiler.
- Workspace test files aren't type-checked by design: `apps/deskohub-workspace/tsconfig.json` excludes `**/*.test.ts` and `**/*.test.tsx`. Don't add a test tsconfig or test typecheck task, and don't report this as a finding.

## Next.js

- Upgrade `next` and every `@next/*` package together: the app tilde ranges, the exact `@next/playwright` pin, and the `next` peer ranges in `packages/i18n` and `packages/next-effect`. Regenerate `bun.lock` with one `bun install`, then confirm `bun install --frozen-lockfile`.
- Keep strict route matching; don't set `deprecated.looseRouteMatching`. Give every sibling parallel-route slot a matching page or `default.tsx` for each URL. `next build` fails on a gap, and `next dev` shows a blocking overlay. Fixtures that copy part of the route tree must copy complete routes, as `e2e/account-legal-fixture.ts` does with the account `@modal` slot.
- Parse RSC flight rows and resolve their references instead of asserting raw rows. The row format changes between minor versions.

## Patched dependencies

The root `patchedDependencies` patch `effect`, `@effect/sql-pg`, and `@effect/openapi-generator` from `patches/`. An upgrade changes the patch key, so re-apply or drop the patch when you upgrade one of them. For `effect` and `@effect/sql-pg`, rerun the guard tests:

- `effect`: a fiber resumed by a callback continues in the async context it suspended in. Without it, Next.js request APIs (`revalidatePath`, `revalidateTag`, `after`, `headers`, `cookies`) can target another request. Keep request APIs inside Effects. Guards: `request async context` in `packages/next-effect/src/index.test.ts` and `apps/deskohub-workspace/db/database-async-context.test.ts`.
- `@effect/sql-pg`: an interrupted statement, or one that fails without a server SQLSTATE, destroys its pooled connection instead of calling `pg_cancel_backend`, so the connection never returns to the pool mid-query or mid-transaction. Guard: `Database pool cancellation against real Postgres` in `apps/deskohub-workspace/db/database-pool-cancellation.test.ts`.

## Generated assets

- After changing an app's message JSON, run `bun turbo i18n:compile --filter=<package-name>` before trusting generated copy or copy-sensitive tests.
- Regenerate OpenAPI clients with the package's `generate` task from its checked-in contract. Don't edit `src/generated/`.
- The Games and Igloohome clients are gitignored. Run their tests through `bun turbo test --filter=<package-name>`, or run `bun run generate` in the package once before a bare `bun test`.
- Generate Workspace migrations and metadata with `bun turbo db:generate --filter=deskohub-workspace`. Never hand-write the Drizzle journal or snapshots.

## Branch integration

When you combine branches, inspect each conflict and decide the exact combined behavior before you resolve it. Keep lockfile reconciliation and generated-file cleanup separate from other changes. Then verify the combined result and get it reviewed.

## Environment files

- Workspace and Boardgame Bar each own a `.env.example`. Copy it to the app-local ignored env file. Keep developer-only values in ignored local overrides.
- Keep Vercel-synced values in the matching ignored `.env.<environment>.local`, not `.env.local`.
- Never commit real env files or print credential values. Load `deskohub-workspace-operations` before you use production integration access.
