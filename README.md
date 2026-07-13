# Deskohub Site

Private Bun/Turborepo monorepo for the Deskohub web properties and shared
integrations. The repository currently contains two production Next.js apps, a
small Astro portal, and shared packages for payments, reservations, email,
media, i18n, and Effect-based backend services.

## Applications

| App | Purpose | Stack |
| --- | --- | --- |
| `apps/deskohub-boardgame-bar` | Public DeskoHub bar site at `bar.deskohub.cz`: home page, Dotypos-backed menu, gallery, board-game catalogue, contact, ChoiceQR table reservations, training room pages, cookie consent, and Dotypos admin setup flows. | Next.js 16, React 19, Tailwind CSS 3, Paraglide, Effect, Dotypos, Cloudinary, Resend |
| `apps/deskohub-workspace` | Deskohub Workspace site at `workspace.deskohub.cz`: landing pages, pricing, gallery, legal pages, availability, checkout, Nexi payments, reservation holds, fulfillment, email notifications, and operational E2E tooling. | Next.js 16, React 19, Tailwind CSS 4, Paraglide, Effect, Drizzle/Postgres, Nexi, Dotypos, Google Calendar, PostHog |
| `apps/deskohub-portal` | Localized portal at `www.deskohub.cz` that redirects/routes visitors into the Deskohub properties. | Astro 6, Paraglide, Vercel adapter |

## Shared Packages

| Package | Purpose |
| --- | --- |
| `@deskohub/cloudinary` | Cloudinary server service, schema helpers, cache tags, errors, and expression helpers. |
| `@deskohub/cloudinary-image` | Cloudinary image URL and React/Next rendering helpers. |
| `@deskohub/dotypos` | Dotypos API client, Effect service, table map UI, and generated OpenAPI bindings. |
| `@deskohub/email` | Provider-independent email service with Resend and console providers. |
| `@deskohub/google-calendar` | Google Calendar Effect service and config for Workspace availability constraints. |
| `@deskohub/i18n` | Locale, pathname, translatable value, Next.js, and next-safe-action helpers. |
| `@deskohub/nexi` | Nexi payment API client, Effect service, webhook/payment interpretation, and generated OpenAPI bindings. |
| `@deskohub/next-effect` | Helpers for running Effect programs from Next.js/server-action boundaries. |
| `osm` | Static map/image helpers backed by Sharp. |
| `@deskohub/qr-code` | QR code generation helper package. |
| `@deskohub/reservation` | Shared reservation exports. |
| `@deskohub/standard-schema` | Standard Schema V1 helper utilities. |

## Tooling

- Package manager: Bun `1.3.14`
- Workspace orchestration: Turborepo `2.9.x`
- Language: TypeScript with strict app/package configs
- Formatting and linting: Biome
- Backend composition: Effect `4.0.0-beta.85`
- Deployment target: Vercel
- Generated clients: `@effect/openapi-generator` for Dotypos and Nexi

## Getting Started

Install dependencies from the repository root:

```bash
bun install
```

Run project commands from the repository root through Turbo. This lets Turbo run
task dependencies such as generated clients and Paraglide output before the
target task.

```bash
# Boardgame Bar
cp apps/deskohub-boardgame-bar/.env.example apps/deskohub-boardgame-bar/.env.local
bun turbo i18n:compile --filter=deskohub-boardgame-bar
bun turbo dev --filter=deskohub-boardgame-bar

# Workspace
cp apps/deskohub-workspace/.env.example apps/deskohub-workspace/.env.local
bun turbo i18n:compile --filter=deskohub-workspace
bun turbo dev --filter=deskohub-workspace

# Portal
bun turbo i18n:compile --filter=deskohub-portal
bun turbo dev --filter=deskohub-portal
```

The two Next.js apps both use the default Next development port unless `PORT` is
set, so run them separately or assign different ports when developing multiple
apps at the same time. The portal dev server uses `127.0.0.1:4321`.

## Common Commands

From the repository root:

```bash
bun turbo dev --filter=<package-name>
bun turbo build --filter=<package-name>
bun turbo lint --filter=<package-name>
bun turbo typecheck --filter=<package-name>
```

Workspace also provides:

```bash
bun turbo test --filter=deskohub-workspace
bun turbo db:generate --filter=deskohub-workspace
bun turbo db:migrate --filter=deskohub-workspace
bun turbo db:studio --filter=deskohub-workspace
bun turbo test:e2e --filter=deskohub-workspace
```

Packages with generated clients or package-level checks expose their own scripts.
For example:

```bash
bun turbo run generate --filter=@deskohub/dotypos
bun turbo typecheck --filter=@deskohub/nexi
```

## Environment

The Boardgame Bar and Workspace apps each own their local env examples:

- `apps/deskohub-boardgame-bar/.env.example`
- `apps/deskohub-workspace/.env.example`

Copy the relevant example to `.env.local` inside the app directory. Keep
developer-only secrets in app-local ignored files such as
`.env.development.local`.

Important integration groups:

- Boardgame Bar: Dotypos credentials, Dotypos webhook secret, Cloudinary,
  optional Resend `EMAIL_API_KEY`, and public domain/analytics settings.
- Workspace: Postgres `DATABASE_URL`, Nexi sandbox/production API settings,
  Dotypos fulfillment credentials, Google Calendar service-account settings,
  email provider settings, Cloudinary, PostHog, checkout token secrets, and
  Vercel callback/protection settings.

Do not commit real env files or quote secret values in logs, issues, or PRs.

## Generated Assets And Migrations

- Paraglide output can be stale after editing `features/i18n/messages/*.json`.
  Run `bun turbo i18n:compile --filter=<app-package>` from the repository root
  before trusting generated message code or updating tests that depend on copy.
- Dotypos and Nexi OpenAPI clients are generated from
  `packages/dotypos/openapi/dotypos-api.yaml` and
  `packages/nexi/openapi/nexi-api.yaml`.
- Workspace database migrations live under
  `apps/deskohub-workspace/db/migrations`. Generate migrations with Drizzle
  tooling rather than hand-writing migration metadata.

## CI And Deployment

- `.github/workflows/workspace-tests.yml` runs Workspace tests for pull requests
  that touch Workspace, shared packages, or root build inputs. Its checkout E2E
  job deploys a fresh Vercel preview, assigns `new.workspace.deskohub.cz`, runs
  the Nexi checkout flow, and uploads artifacts on failure.
- `.github/workflows/mirror-repository.yml` mirrors `main` to the configured
  mirror repository as a squashed commit.
- `.github/workflows/cleanup-neon-preview-branch.yml` contains the Neon preview
  branch cleanup job, currently guarded off with `if: ${{ false }}`.

For the full Workspace preview checkout procedure, see
[`apps/deskohub-workspace/docs/WORKSPACE_VERCEL_PREVIEW_E2E.md`](./apps/deskohub-workspace/docs/WORKSPACE_VERCEL_PREVIEW_E2E.md).

## Documentation

Start with [`docs/README.md`](./docs/README.md) for the documentation index.
Useful entry points:

- [`docs/PROJECT_STRUCTURE.md`](./docs/PROJECT_STRUCTURE.md) - feature-based
  architecture and import conventions.
- [`docs/BEST_PRACTICES.md`](./docs/BEST_PRACTICES.md) - TypeScript, React,
  styling, validation, i18n, and accessibility conventions.
- [`docs/CACHING_STRATEGY.md`](./docs/CACHING_STRATEGY.md) - cache tags,
  invalidation, and webhook revalidation.
- [`packages/dotypos/docs/OPENAPI_INTEGRATION.md`](./packages/dotypos/docs/OPENAPI_INTEGRATION.md)
  - Dotypos OpenAPI generation and service architecture.
- [`packages/nexi/docs/TESTING_API.md`](./packages/nexi/docs/TESTING_API.md) -
  Nexi sandbox API origin, public test keys, and test cards.
- [`apps/deskohub-boardgame-bar/docs/RESEND_SETUP.md`](./apps/deskohub-boardgame-bar/docs/RESEND_SETUP.md)
  - Boardgame Bar email setup.
- [`apps/deskohub-workspace/docs/checkout-lifecycle.md`](./apps/deskohub-workspace/docs/checkout-lifecycle.md)
  - Workspace checkout lifecycle contract.
