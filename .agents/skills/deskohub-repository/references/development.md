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
- The Workspace build tasks (`build:compile`, `build:source-maps`, `build`) set `cache: false`. They all write the same `.next`, so replaying one task's outputs without the others would deploy a mixed build, and Skew Protection needs each deployment's `NEXT_PUBLIC_VERCEL_*` values compiled in, so a cache hit across deployments would be wrong anyway. Because they aren't hashed, they list only the variables global pass-through lacks (`BETTER_AUTH_SECRETS`) in `passThroughEnv`. Only `i18n:compile`, whose inputs are just messages and Inlang settings, excludes `NEXT_PUBLIC_VERCEL_*` from its hash.

## Workspace builds

- The Vercel Workspace project uses Elastic build machine selection (since 2026-10-19), which can pick 4–30 cores and 8–60 GB per build. Until 2026-10-20 it assigned the standard 4-core, 8 GB machine to every build, including the one after an OOM-killed preview. At 09:17 UTC that day it upgraded the project to the 8-core, 16 GB Enhanced machine (`resourceConfig.buildMachineElasticReason: "long-build-duration"`, after several cold builds). On Enhanced, a cold compile still took 4.5–4.8 min and a warm build about the same wall time, so builds billed twice the CPU minutes (warm 32, cold 72). Vercel documents that a warm-cache build doesn't trigger a downgrade, so the project can stay on Enhanced after cold builds; check `GET /v9/projects/{id}` `resourceConfig`. Each deployment records its machine in `resourceConfig.buildMachine` (`GET /v13/deployments/{id}`), and the build log starts with "Build machine configuration". Build CPU minutes are cores × build minutes at the same price per CPU minute on every size, so a bigger machine costs more unless the build gets proportionally faster. Vercel drops build caches over 1.5 GB.
- With the Turbopack build cache on, a cold compile holds about 5.5 GB in `next-build` plus about 0.8 GB of Turbopack's Node.js loader processes, then grows to about 7.1 GB while it writes the cache. Anything that starts at that boundary stacks on top of it. A probe that logs per-process RSS from a build script, on a throwaway branch, shows where memory goes.
- `turbo run build` (Vercel runs it through the `vercel-build` script) chains the Workspace build as turbo tasks: `typegen` → `typecheck` (native `tsc --noEmit`) → `build:compile` (`next build --experimental-build-mode=compile`) → `build:source-maps` → `build` (`next build --experimental-build-mode=generate`). Each runs in its own process after the previous one exits. Running the `build` script alone only generates, so build through turbo. CI's compile-only check runs `turbo run build:compile`. `typecheck` also runs `^typecheck` for the Workspace's packages, which usually hit turbo's remote cache.
- `next.config.mjs` sets `typescript.ignoreBuildErrors: true`. Next's own check runs the TS6 compiler in a worker that needs about 3–3.5 GB beside `next build`. In October 2026 it hung until Vercel's 45-minute timeout or got OOM-killed (exit 137) on main and many branches. The native check takes about 15 s on Vercel and exits before `next build` starts, so every deployment validates app and route types before compiling, independent of CI.
- Compile and generate run as separate `next build` processes because in a single one Turbopack writes its cache while page data is collected, and a cold build was OOM-killed there. Separately, the compile process exits after writing, and generation peaks at about 1.4 GB.
- `build:source-maps` (`scripts/upload-source-maps.ts`) runs `posthog-cli sourcemap process --delete-after` on `.next` in production only (`VERCEL_ENV=production`): it injects chunk and release IDs into the chunks, uploads the source maps, then deletes them and their `sourceMappingURL` comments. Elsewhere it logs a skip, and `next.config.mjs` emits browser source maps only in production, so nothing un-uploaded is deployed. A production build without `POSTHOG_API_KEY`, `POSTHOG_API_HOST`, or `POSTHOG_PROJECT_ID`, or whose upload fails, fails. It runs before generation, where `@posthog/nextjs-config`'s after-compile hook used to run, but outside the compile process: `posthog-cli` takes about 1 GB for 11–22 s, and inside the compile process it overlapped the cache write, so a cold production compile in a local 4-CPU, 8 GB container reached 7.9 GB RSS and hit the cgroup limit. Run separately, the same compile peaked at 7.6 GB and the upload at 1.2 GB. To exercise the upload without production side effects, set `VERCEL_ENV=production`, point `POSTHOG_API_HOST` at a local stub, and use a synthetic `phx_` key.
- `experimental.cpus: 1` runs page-data collection and static generation in one worker, which starts at up to 1 GB. Static generation takes about 50 s, because a worker prerenders up to 8 pages at once.
- The `build:compile` and `build` scripts set `MIMALLOC_PURGE_DELAY=0` for `next build`. Turbopack's native allocator, mimalloc 3.1.5, otherwise holds freed pages for 1 s before returning them to the OS. In the local 4-CPU, 8 GB container, a cold production compile then peaked at 7.15–7.20 GB cgroup instead of 7.6–7.8 GB, over four runs, with no slower compile. Set it in the scripts, not in Vercel's environment, so every build path gets it. On Vercel, together with the Paraglide locale modules, cold previews on 2026-10-20 compiled in about 84 s, peaked at 6.4–6.6 GB RSS / 7.3–7.4 GB cgroup, and billed 24 CPU-minutes. `TURBO_TASKS_AVAILABLE_PARALLELISM=2` lowered that to 5.7–5.8 GB RSS / 6.9–7.0 GB cgroup but stretched the compile to about 2.2 min; it isn't set.
- Turbopack's build filesystem cache (on by default in Next 16.4) lives in `.next/cache/turbopack`, which Vercel restores between builds. A cold Vercel build compiles in about 4.9 min and takes about 6.7 min to "Build Completed". A warm one compiles in 3–6 s and takes about 1.6 min. Its peak RSS, 4.2–5.1 GB, comes from the native `tsc` check; the Next compile and generate runs peak at 1.8–2.4 GB. Next prints no "restored" line, so judge reuse by the compile time. The cache is about 800 MB and grows 10–25 MB per warm build until Turbopack compacts it on its own; `next internal post-build` compaction doesn't shrink it further. `experimental.turbopackGc` removes unreachable work from it. Vercel's upload also carries about 550–650 MB besides `.next/cache`, so the total is about 1.35 GB against the 1.5 GB limit. When it goes over, Vercel drops the cache and the next build runs cold. A build that starts while the previous build is still uploading its cache logs "Couldn't download build caches" and also runs cold. A cold build sits at the edge of 8 GB: on 2026-10-19 one cold preview peaked at 7.2 GB RSS (7.9 GB cgroup) and passed, and the next was OOM-killed in the compile run at the same RSS while Turbopack wrote its cache. A cold build bills 36–40 CPU-minutes, a warm one 16.
- Don't re-enable Next's build-time type check, merge the compile, source-map, and generate tasks or let them run concurrently, or raise `experimental.cpus`, without re-measuring a cold production build on the 8 GB machine.

## Toolchain

- Bun is pinned to 1.4.2 in `packageManager`, `@types/bun`, and every workflow's `bun-version`. Change them together and never go below 1.4.0. Bun 1.3 writes a self-referential `@typescript/old` record into `bun.lock`, and `bun install --force` keeps a bad record, so regenerate the lock only with Bun 1.4 or later.
- `@typescript/native` (`npm:typescript@7.x`) provides `tsc`. The root `prepare` script patches it with `effect-tsgo`. `typescript` (`npm:@typescript/typescript6`) provides the TS6 API for typescript-eslint and Next.js and the `tsc6` CLI. Never add a plain `typescript` dependency or another package that provides a `tsc` bin.
- Next apps set `experimental.useTypeScriptCli: false` because the TS6 wrapper has no `tsc` bin. Next type-checks Boardgame Bar builds through its TS6 API. The Workspace `typecheck` task, which its build depends on, runs the patched native compiler.
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
