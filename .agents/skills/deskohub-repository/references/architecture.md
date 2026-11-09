# Repository architecture

## Top-level boundaries

- `apps/` holds deployable products: Workspace and Boardgame Bar (Next.js), the portal (Astro), and the `dhw` CLI.
- `packages/` holds shared capabilities and generated integration clients.
- Business product and policy specifications live in each app's `docs/` folder (and `apps/deskohub-workspace/PRODUCT.md`). Implementation guidance lives in `.agents/skills/`.

Resolve file placement from the owning app or package; the root isn't a Next.js app.

## Next.js app modules

- `app/` owns route composition and independently addressable HTTP boundaries.
- `features/` owns business capabilities with their UI, actions, schemas, and backend services. Keep feature internals private and import a feature through its public API when one exists.
- `shared/` owns cross-feature primitives and infrastructure. Keep it independent of feature internals.

Render on the server by default. Add a client boundary only for browser state or interaction, and keep provider integrations and secrets on the server. Browser modules must not import server-only capabilities.

Use the app's path aliases, such as `@/` in Workspace. Keep public index modules to explicit named exports, never `export *`.

## Shared packages

- Create a package when a capability is shared across apps or is generated and versioned on its own. Keep app-owned business policy in the app even when its implementation is generic.
- Treat generated clients as contract boundaries. Wrap them in domain-named services instead of duplicating their response schemas in each consumer.
