# Repository development

## Toolchain

- Use Bun from the repository's pinned version.
- Run workspace orchestration through Turborepo from the repository root when task dependencies or generated outputs matter.
- Declare task dependencies with Turbo `dependsOn`. Keep package scripts as leaf commands; compose lint checks and generation prerequisites in the Turbo graph rather than shell chains or script-to-script calls.
- Every package containing checked-in source must expose a lint task so the root lint graph covers it.
- Inspect the target package's `package.json` before assuming it exposes a command.

## Bootstrap and development

Install dependencies from the repository root:

```bash
bun install
```

Run an application through its package name:

```bash
bun turbo dev --filter=<package-name>
```

The Next.js applications use the same default development port. Set `PORT` when running them together. The portal uses its own Astro development address.

## Patched dependencies

`@effect/sql-pg` is pinned through `patchedDependencies` in the root `package.json` (`patches/@effect%2Fsql-pg@4.0.0-beta.85.patch`). The patch eliminates pooled `pg_cancel_backend` entirely: an interrupted statement, or one that fails without a server SQLSTATE code (for example pg's `Query read timeout`), destroys its connection lease, so the pool removes and ends the connection, the backend terminates by session teardown (bounded by `statement_timeout`), and the connection can never be handed to another fiber or leak an open transaction. Server-classified SQLSTATE failures keep the connection. The `Database pool cancellation against real Postgres` seam in `apps/deskohub-workspace/db/database-pool-cancellation.test.ts` guards the behavior against a production-style external pool with `query_timeout` shorter than `statement_timeout`; rerun it (and re-apply or drop the patch) whenever `@effect/sql-pg` is upgraded, since a version change invalidates the patch key.

## Branch integration

Before delegating a merge, the orchestrator inspects each conflict and decides the exact combined behavior. Assign each worker one file or tightly coupled production-and-test pair, the prescribed resolution, and one focused check. Keep lockfile reconciliation and generated-file cleanup separate. The orchestrator verifies the combined result and requests its review; a worker assignment is not "integrate main" or "resolve all conflicts".

## Checks

Prefer focused checks first, then the affected application or package suite:

```bash
bun turbo lint --filter=<package-name>
bun turbo typecheck --filter=<package-name>
bun turbo test --filter=<package-name>
bun turbo build --filter=<package-name>
```

Workspace has additional database and E2E tasks. Read the Workspace operations or E2E skill before running them against any shared or hosted environment.

## Environment files

Each application owns its `.env.example`. Copy it to the app-local ignored environment file and keep developer-only values in app-local ignored overrides.

Keep Vercel-synced values in the matching ignored `.env.<environment>.local` file rather than the generic `.env.local`.

Never commit real environment files or print credential values. Read the Workspace operations skill before using production integration access.

## Generated assets

- Compile an application's localized messages after changing its message JSON and before trusting generated copy or copy-sensitive tests: `bun turbo i18n:compile --filter=<package-name>`.
- Regenerate Dotypos and Nexi clients from their checked-in OpenAPI contracts rather than editing generated files.
- Generate Workspace database migrations and metadata with Drizzle tooling. Never hand-write its journal or snapshots.

## Workspace build-cache boundary

The Workspace `build` hash must retain Vercel's deployment-specific `NEXT_PUBLIC_VERCEL_*` inputs. They carry the version information required by Skew Protection, so a cache miss between deployments is expected. Do not exclude those variables from `build` to force a full Next.js cache hit.

The independent `i18n:compile` task may exclude `NEXT_PUBLIC_VERCEL_*` because its declared inputs are only the message files and Inlang configuration. This lets unchanged generated messages come from the remote cache without weakening the deployment-specific application build. Keep this distinction when editing `apps/deskohub-workspace/turbo.json`.

## CI boundaries

- Monitor an active GitHub run with `timeout <seconds> gh run watch <run-id> --exit-status --interval <seconds>`. Use `gh run view` for a one-time status inspection, not a `sleep`-then-inspect polling loop. A local watch timeout does not cancel the remote workflow.
- Workspace tests cover changes to Workspace, shared packages, and root build inputs.
- Workspace E2E starts from the successful immutable protected preview for the exact commit.
- The `dhw` CLI and its shared administration contract have a release-producing commit requirement. Read the Workspace administration reference before changing that boundary.
- Preview database lifecycle is owned by the hosting integration. Repository workflows do not delete those branches.
