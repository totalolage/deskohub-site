# DeskohHub Documentation Index

This directory contains project docs for architecture, integrations, and operational notes.

## Core Guides

- [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) - Current feature-based architecture, import conventions, and directory map.
- [`BEST_PRACTICES.md`](./BEST_PRACTICES.md) - Coding standards for TypeScript, React, styling, i18n, validation, and accessibility.
- [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) - How runtime feature toggles work in this codebase (static config in constants).
- [`CACHING_STRATEGY.md`](./CACHING_STRATEGY.md) - Server caching/tag invalidation patterns and webhook revalidation behavior.

## Integration Guides

- [`../packages/dotypos/docs/OPENAPI_INTEGRATION.md`](../packages/dotypos/docs/OPENAPI_INTEGRATION.md) - OpenAPI client generation and Dotypos package service architecture.
- [`../packages/dotypos/docs/REFRESH_TOKEN.md`](../packages/dotypos/docs/REFRESH_TOKEN.md) - Dotypos Connector v2 refresh-token acquisition flow.
- [`../apps/deskohub-boardgame-bar/docs/DOTYPOS_SIMPLE_INTEGRATION.md`](../apps/deskohub-boardgame-bar/docs/DOTYPOS_SIMPLE_INTEGRATION.md) - Boardgame Bar reservation flow from table reservation action to Dotypos.
- [`../apps/deskohub-boardgame-bar/docs/DOTYPOS_RESERVATIONS_INTEGRATION.md`](../apps/deskohub-boardgame-bar/docs/DOTYPOS_RESERVATIONS_INTEGRATION.md) - Boardgame Bar Dotypos reservation capabilities and limitations.
- [`../apps/deskohub-workspace/docs/NEXI_WORKSPACE_CHECKOUT_MODEL.md`](../apps/deskohub-workspace/docs/NEXI_WORKSPACE_CHECKOUT_MODEL.md) - Workspace Nexi checkout storage model and post-payment reservation flow.
- [`../apps/deskohub-workspace/docs/NEXI_WORKSPACE_DATABASE_SPEC.md`](../apps/deskohub-workspace/docs/NEXI_WORKSPACE_DATABASE_SPEC.md) - Database handoff specification for Workspace Nexi checkout implementation.
- [`../apps/deskohub-workspace/docs/WORKSPACE_DATABASE_IMPL.md`](../apps/deskohub-workspace/docs/WORKSPACE_DATABASE_IMPL.md) - Workspace database implementation handoff and architecture notes.
- [`../packages/nexi/docs/TESTING_API.md`](../packages/nexi/docs/TESTING_API.md) - Nexi XPay CEE sandbox API origin, test keys, accounting terminal behavior, and test cards.
- [`../apps/deskohub-workspace/docs/WORKSPACE_VERCEL_PREVIEW_E2E.md`](../apps/deskohub-workspace/docs/WORKSPACE_VERCEL_PREVIEW_E2E.md) - Preview deployment and Nexi payment/notification E2E checklist.
- [`../apps/deskohub-boardgame-bar/docs/WEBHOOK_TESTING.md`](../apps/deskohub-boardgame-bar/docs/WEBHOOK_TESTING.md) - Boardgame Bar local/dev reservation webhook testing workflow.
- [`../apps/deskohub-boardgame-bar/docs/RESEND_SETUP.md`](../apps/deskohub-boardgame-bar/docs/RESEND_SETUP.md) - Boardgame Bar email provider setup and provider-selection behavior.

## Environment Notes

- [`DEV_ENVIRONMENT_UTILS.md`](./DEV_ENVIRONMENT_UTILS.md) - `isDev()` behavior and development-only tooling.

## Project Commands (Bun)

```bash
bun run dev
bun run lint
bun run typecheck
bun run validate
bun run build
```

## Notes

- Prefer docs in this folder over stale references in old tickets/PRs.
- When architecture changes, update `PROJECT_STRUCTURE.md` and link the change here.
