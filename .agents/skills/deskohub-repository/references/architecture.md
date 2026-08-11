# Repository architecture

## Top-level boundaries

- `apps/` contains deployable customer and operator products.
- `packages/` contains shared capabilities and generated integration clients.
- `.agents/skills/` contains implementation, architecture, testing, diagnostic, and operational guidance for agents.
- Business-oriented product and policy specifications live beside the owning application.

Do not use the root as if it were one Next.js application. Resolve file placement from the owning app or package first.

## Application modules

Within a Next.js application:

- `app/` owns route composition and independently addressable HTTP boundaries.
- `features/` owns business capabilities and their UI, actions, schemas, and backend services.
- `shared/` owns genuinely cross-feature primitives and infrastructure within that application.

Keep feature internals private. Expose stable cross-feature APIs through explicit named exports. Do not put reusable code in whichever feature happened to need it first.

Prefer server rendering by default and introduce a client boundary only for browser state or interaction. Keep provider integrations and secrets on server-owned boundaries.

## Shared packages

Use a package when a capability is shared across applications or is independently generated and versioned. Do not move an app-owned business policy into a package merely because its implementation is generic.

Generated clients are contract boundaries. Wrap them with domain-named application or package services instead of duplicating their response schemas in each consumer.

## Naming and imports

- Name code for the concept callers use, not its hidden implementation.
- Use an application's configured path aliases within that application.
- Import a feature through its public API when one exists.
- Keep shared utilities independent of feature internals.
- Preserve the server/client boundary in imports; browser modules must not pull in server-only capabilities.
