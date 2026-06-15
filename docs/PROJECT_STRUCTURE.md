# DeskohHub Project Structure

This project uses a feature-based architecture: business capabilities live in `features/*`, shared building blocks live in `shared/*`, and route composition happens in `app/*`.

## Top-Level Layout

```text
deskohub-site/
|- app/                     # Next.js App Router (localized pages + API routes)
|- features/                # Business features (public API via each feature's index.ts)
|- shared/                  # Shared backend utils, UI primitives, and helper utilities
|- components/              # Small compatibility layer (legacy/non-feature UI)
|- docs/                    # Project documentation
|- assets/ public/          # Static assets
|- env.ts                   # Runtime env validation (server + client)
```

## App Router

- Localized pages are under `app/[locale]`.
- API handlers are under `app/api` (for example `app/api/webhooks/reservation/route.ts`).
- The project uses server components by default, with client components for localized interactivity.

## Feature Modules

Current feature directories:

- `features/analytics`
- `features/board-games`
- `features/contact`
- `features/cookie-consent`
- `features/dotypos`
- `features/email`
- `features/gallery`
- `features/gdpr`
- `features/home`
- `features/i18n`
- `features/localization`
- `features/location`
- `features/menu`
- `features/navigation`
- `features/partner-logos`
- `features/reservation`
- `features/table-reservation`
- `features/theme`
- `features/training`
- `features/webhook`

Typical feature shape:

```text
features/[feature]/
|- actions/      # server actions (if needed)
|- backend/      # Effect services, external API integration (if needed)
|- components/   # feature UI
|- hooks/        # feature hooks
|- schemas/      # validation schemas
|- utils/        # feature-local helpers
`- index.ts      # public exports for other modules
```

## Shared Modules

- `shared/components/ui` contains shadcn-style primitives used across features.
- `shared/backend` contains shared server-side concerns (errors, config, action helpers).
- `shared/utils` contains cross-feature utilities (`constants`, formatting, cache tags, safe-action client, etc.).
- `shared/hooks` contains lightweight reusable hooks.

## Import Conventions

```ts
// Feature public API
import { DotyposService } from "@/features/dotypos";

// Shared utilities
import { siteConstants } from "@/shared/utils/constants";

// Shared UI primitives
import { Button } from "@/shared/components/ui/button";

// i18n
import { getLocale, m } from "@/features/i18n";
```

Avoid importing feature internals directly when a feature `index.ts` already exposes the API.

## Architecture Principles

1. Keep features self-contained and export only stable APIs.
2. Put truly reusable code in `shared/*`, not in another feature's internals.
3. Keep server-side integrations in feature `backend/` or `shared/backend/`.
4. Use strict TypeScript and schema validation at boundaries.
5. Prefer explicit, typed interfaces over implicit cross-feature coupling.
