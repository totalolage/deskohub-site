# Repository development

## Toolchain

- Use Bun from the repository's pinned version.
- Run workspace orchestration through Turborepo from the repository root when task dependencies or generated outputs matter.
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

Never commit real environment files or print credential values. Read the Workspace operations skill before using production integration access.

## Generated assets

- Compile an application's localized messages after changing its message JSON and before trusting generated copy or copy-sensitive tests: `bun turbo i18n:compile --filter=<package-name>`.
- Regenerate Dotypos and Nexi clients from their checked-in OpenAPI contracts rather than editing generated files.
- Generate Workspace database migrations and metadata with Drizzle tooling. Never hand-write its journal or snapshots.

## Workspace build-cache boundary

The Workspace `build` hash must retain Vercel's deployment-specific `NEXT_PUBLIC_VERCEL_*` inputs. They carry the version information required by Skew Protection, so a cache miss between deployments is expected. Do not exclude those variables from `build` to force a full Next.js cache hit.

The independent `i18n:compile` task may exclude `NEXT_PUBLIC_VERCEL_*` because its declared inputs are only the message files and Inlang configuration. This lets unchanged generated messages come from the remote cache without weakening the deployment-specific application build. Keep this distinction when editing `apps/deskohub-workspace/turbo.json`.

## CI boundaries

- Workspace tests cover changes to Workspace, shared packages, and root build inputs.
- Workspace E2E starts from the successful immutable protected preview for the exact commit.
- The `dhw` CLI and its shared administration contract have a release-producing commit requirement. Read the Workspace administration reference before changing that boundary.
- Preview database lifecycle is owned by the hosting integration. Repository workflows do not delete those branches.
