# Boardgame Bar runtime conventions

## Static feature flags

Boardgame Bar release gates live in `siteConstants.featureFlags` and ship with the deployed code. Use them at the page, primary action, or major presentation boundary. Changing one requires a deployment.

Current keys are `boardGamesList`, `boardroomReservations`, `contactForm`, `tableReservations`, `gallery`, and `menuPdfDownload`. Add a cleanup task when a new flag is intentionally temporary.

## Development-only behavior

Use the existing environment utility for development-only diagnostics. Do not create scattered direct environment checks or weaken webhook authentication based on a browser-controlled value.

## Cache tags

Use the helpers in `shared/utils/cache-tags.ts` for cached server functions. Apply stable domain tags, including both broad and entity-specific tags when callers need those invalidation scopes. Invalidate only the affected tags after a mutation or authenticated provider notification.

Keep cache behavior server-side and do not introduce ad hoc tag strings beside individual call sites.
