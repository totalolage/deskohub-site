# DeskohHub Documentation Index

This directory contains project docs for architecture, integrations, and operational notes.

## Core Guides

- [`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md) - Current feature-based architecture, import conventions, and directory map.
- [`BEST_PRACTICES.md`](./BEST_PRACTICES.md) - Coding standards for TypeScript, React, styling, i18n, validation, and accessibility.
- [`FEATURE_FLAGS.md`](./FEATURE_FLAGS.md) - How runtime feature toggles work in this codebase (static config in constants).
- [`CACHING_STRATEGY.md`](./CACHING_STRATEGY.md) - Server caching/tag invalidation patterns and webhook revalidation behavior.

## Integration Guides

- [`dotypos-openapi-integration.md`](./dotypos-openapi-integration.md) - OpenAPI client generation and Dotypos service architecture.
- [`dotypos-simple-integration.md`](./dotypos-simple-integration.md) - High-level reservation flow from table reservation action to Dotypos.
- [`dotypos-reservations-integration.md`](./dotypos-reservations-integration.md) - Reservation-specific Dotypos capabilities and limitations.
- [`NEXI_WORKSPACE_CHECKOUT_MODEL.md`](./NEXI_WORKSPACE_CHECKOUT_MODEL.md) - Workspace Nexi checkout storage model and post-payment reservation flow.
- [`NEXI_WORKSPACE_DATABASE_SPEC.md`](./NEXI_WORKSPACE_DATABASE_SPEC.md) - Database handoff specification for Workspace Nexi checkout implementation.
- [`WORKSPACE_VERCEL_PREVIEW_E2E.md`](./WORKSPACE_VERCEL_PREVIEW_E2E.md) - Preview deployment and Nexi payment/notification E2E checklist.
- [`WEBHOOK_TESTING.md`](./WEBHOOK_TESTING.md) - Local/dev webhook testing workflow.
- [`RESEND_SETUP.md`](./RESEND_SETUP.md) - Email provider setup and provider-selection behavior.

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
