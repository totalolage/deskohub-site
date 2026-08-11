---
name: deskohub-workspace-account
description: Workspace customer account, Neon Auth, magic link, profile, account deletion, and reservation history handling.
---

# Workspace customer accounts

## Identity boundary

- Use current managed Neon Auth through `@neondatabase/auth`; do not use the legacy Stack Auth integration or `neon_auth.users_sync` model.
- Keep `@neondatabase/auth` and `@neondatabase/auth-ui` pinned to exact beta versions. Review the Neon changelog before upgrading because beta minor releases may include breaking changes.
- Managed Neon Auth stores users, sessions, and configuration in the `neon_auth` schema of the same branch and default database used by Workspace `DATABASE_URL`. `NEON_AUTH_BASE_URL` is that branch's managed Auth API endpoint, not a second database connection.
- Neon Auth owns the user ID, name, verified email, sessions, and magic-link lifecycle.
- Dotypos owns customer contact data and live booking facts.
- Workspace stores only a one-to-one link from the opaque Neon account ID to the opaque Dotypos customer ID in `customer_account_links`. Do not duplicate account email or name in the Workspace schema.
- Never add a foreign key from app tables to the managed `neon_auth` schema. Auth branches have distinct endpoints and session populations.

## Linking and reservation history

- Claim a Dotypos customer only from a verified Neon session and an exact email lookup.
- Preserve an existing link even if a profile name changes. The unique Dotypos customer constraint prevents two auth accounts from claiming the same history.
- Query Workspace reservations with an explicit customer-safe selection. Never expose customer access codes, checkout state tokens, payment payloads, failure payloads, or accounting snapshots to the account page.
- Use Dotypos as the live source for booking dates, seats, and provider status. Provider-only bookings may appear with a generic Workspace label.
- Treat ended and cancelled bookings as past reservations. If Dotypos cannot be reached, show a temporary-unavailability state rather than stale live facts.

## Auth routes and sessions

- Configure the server singleton from `NEON_AUTH_BASE_URL` and a stable `NEON_AUTH_COOKIE_SECRET` of at least 32 characters.
- Set auth cookies to `SameSite=Lax` explicitly so top-level magic-link returns can carry the session.
- Mount the proxy handler at `/api/auth/[...path]` and exclude API routes from the Next proxy matcher.
- Protect localized `/[locale]/account` routes in the proxy and re-check `auth.getSession()` in every page and Server Action. Authenticated Server Actions do not require BotID human verification.
- Render all auth-dependent pages dynamically. Never cache a user session or account page across requests.
- Use one magic-link form for both sign-in and sign-up. Neon Console must keep new-user registration enabled for this behavior.

## Profile and deletion

- The bare profile supports name updates only. Display the verified email as read-only; changing it would invalidate the reservation-history claim boundary.
- Require an explicit confirmation before deletion and re-check the server session.
- Delete the Workspace account link before calling Neon user deletion. If Neon deletion fails, a surviving user can safely re-establish the link on the next account load.
- Account deletion removes the login identity, profile, sessions, and link. It must not delete Dotypos reservations, Workspace reservation/payment/accounting ledgers, or other records retained for service or legal obligations. Direct broader privacy requests to the published privacy contact.

## Neon Console and deployment checklist

- Enable Auth on the existing Neon project through its linked Neon/Vercel integration, then enable the Magic Link plugin. The integration provisions matching Auth instances for preview branches.
- Keep new-user registration enabled, configure dedicated SMTP for production, and verify sender/domain delivery. Shared SMTP is only suitable for development and is rate-limited.
- Add exact production application domains and only the narrow preview wildcard needed for Vercel previews. Localhost is supported for development.
- Set the production-facing application name and disable `Allow Localhost` on the production Auth configuration after local testing is complete.
- Let the Neon/Vercel integration inject the matching `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, and `NEON_AUTH_BASE_URL` for every deployment. Never add a static preview override for the Auth URL. Configure only the stable `NEON_AUTH_COOKIE_SECRET` as an application secret. Sessions do not cross Neon branches.
- Neon Auth currently requires an AWS-region Neon project and is not compatible with IP Allow or Private Networking.
- Validate magic-link request, return, session refresh, logout, profile update, and deletion on the real preview domain before promotion.

## Protected-preview E2E

- Exercise account Auth through the ordinary immutable preview and the integration-created Neon Auth instance on the same `preview/<head-ref>` branch and `neondb` database. Never provision an E2E-only Auth database or set a static Auth base URL.
- Capture automated magic links with Neon's branch-scoped `send.magic_link` webhook. Verify the detached Ed25519 JWS over the raw request body, enforce timestamp freshness and event idempotency, and accept only the expected synthetic email, sign-in link type, Auth origin, and exact preview callback.
- A subscribed `send.magic_link` webhook replaces built-in delivery. The E2E receiver therefore validates real token issuance, app-proxy verification, session creation, and the account journey, but not production SMTP transport. Keep production SMTP/domain health as a separate deployment concern.
- Do not read or mutate Neon-owned verification or session tables to manufacture links or sessions. The webhook payload is the supported handoff. Keep the raw token and complete link in memory only, register both with the process redactor immediately, suppress the verification navigation command, and sanitize query values in artifacts.
- Snapshot and restore the branch webhook configuration in an interruption-safe finalizer. Disable a stale `*.trycloudflare.com` E2E webhook before restoring normal delivery. Delete only the captured synthetic Auth user as failure cleanup; successful product deletion must already have removed it.

## Migration note

The repository currently has a customized `discount_targets` rollout migration whose SQL and snapshot intentionally differ, plus migration folder timestamps that do not reflect the snapshot dependency order. Drizzle may rediscover `discount_targets` while generating the next migration. Generate the snapshot with explicit create hints, then keep only the new task's additive SQL; do not create `discount_targets` twice or drop the compatibility table as an unrelated side effect.

## References

- https://neon.com/docs/auth/overview
- https://neon.com/docs/auth/quick-start/nextjs-api-only
- https://neon.com/docs/auth/guides/plugins/magic-link
- https://neon.com/docs/auth/guides/user-management
- https://neon.com/docs/auth/guides/configure-domains
- https://neon.com/docs/auth/production-checklist
- https://neon.com/docs/auth/branching-authentication
- https://neon.com/docs/auth/guides/webhooks
- https://api-docs.neon.tech/reference/getneonauthwebhookconfig
- https://api-docs.neon.tech/reference/updateneonauthwebhookconfig
- https://api-docs.neon.tech/reference/deletebranchneonauthuser
- https://neon.com/docs/changelog/2026-01-16
