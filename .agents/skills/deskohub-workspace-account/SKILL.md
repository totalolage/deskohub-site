---
name: deskohub-workspace-account
description: Workspace customer account, Neon Auth, magic link, profile, account deletion, and reservation history handling.
---

# Workspace customer accounts

## Identity boundary

- Use managed Neon Auth through the unified `@neondatabase/auth` package. Do
  not use legacy Stack Auth, query `neon_auth` tables, or add a generic auth
  provider abstraction.
- Neon Auth uses the same branch and default database as Workspace. The
  integration-provided `NEON_AUTH_BASE_URL` is an API endpoint, not a second
  database connection.
- Neon owns identities, verified email, profile name, sessions, and magic-link
  tokens. Dotypos owns customer contact data and live reservation facts.
- Workspace stores only the one-to-one opaque ID mapping in
  `customer_account_links`. Never persist another copy of profile data or add a
  foreign key into Neon's managed schema.

## Resolution contract

- `resolveCurrentCustomerAccount()` is the only public identity-to-customer
  operation. It returns `CustomerAccountId` and `DotyposCustomerId` without
  exposing session or profile data.
- Require the authoritative current session and verified email. Existing links
  are authoritative. New links require one exact-email match to one active
  Dotypos customer with a valid ID.
- Claim links with database uniqueness and conflict rereads so same-account
  races are idempotent and a customer claimed by another account is rejected.
- Keep authentication-not-configured, unauthenticated, unverified-email,
  link-required, and unavailable as a closed error contract. Missing or partial
  Auth configuration must fail closed without breaking unrelated routes or
  builds.
- Do not create a Dotypos customer from Auth data; Dotypos customer creation
  requires additional contact input.

## Routes, profile, and deletion

- Configure the lazy server client with the integration's
  `NEON_AUTH_BASE_URL` and a stable `NEON_AUTH_COOKIE_SECRET` of at least 32
  characters. Keep `SameSite=Lax` for top-level magic-link returns.
- Proxy all supported provider methods through `/api/auth/[...path]`. Use a
  single magic-link form for sign-in and implicit sign-up.
- Render account and auth pages dynamically. The account page and every Server
  Action re-check the current session; the Next proxy is not the authorization
  boundary. It only marks account responses `private, no-store`.
- The bare profile changes only the name. Verified email remains read-only
  because it is the reservation-linking trust boundary.
- Require explicit confirmation for account deletion. Unlink the local mapping
  before deleting the Neon user. Never delete retained Dotypos reservations,
  payments, invoices, or legal evidence.

## Protected-preview E2E

- Run Auth against the integration-created Auth instance on the exact Neon
  preview branch and the immutable Vercel preview. Never use an E2E-only Auth
  database or a static preview Auth URL.
- Capture `send.magic_link` with Neon's branch webhook API. Verify the detached
  Ed25519 JWS over the raw body, timestamp freshness, event ID, expected
  synthetic email, sign-in link type, Auth origin, token, and exact preview
  callback.
- A magic-link webhook replaces built-in email delivery; this covers real token
  issuance, verification, session creation, and product behavior, not SMTP
  delivery health.
- Keep links and tokens in memory, register them with the E2E redactor, restore
  the previous webhook in an interruption-safe finalizer, disable stale quick
  tunnels, and delete only captured synthetic Auth users.
- The Playwright lifecycle must cover anonymous protection, invalid email,
  sign-up, current history, profile update, logout, returning login, past
  history, confirmation-gated deletion, session/link removal, and fresh sign-up
  after deletion.

## Deployment checklist

- Let the Neon/Vercel integration inject the matching database URLs and Auth
  base URL for every branch. Configure only the stable cookie secret manually.
- Enable Magic Link and new-user registration, configure dedicated production
  SMTP, restrict trusted domains, and validate the complete flow on a real
  preview before promotion.

## References

- https://neon.com/docs/auth/overview
- https://neon.com/docs/auth/quick-start/nextjs-api-only
- https://neon.com/docs/auth/guides/plugins/magic-link
- https://neon.com/docs/auth/guides/user-management
- https://neon.com/docs/auth/guides/configure-domains
- https://neon.com/docs/auth/production-checklist
- https://neon.com/docs/auth/branching-authentication
- https://neon.com/docs/auth/guides/webhooks
