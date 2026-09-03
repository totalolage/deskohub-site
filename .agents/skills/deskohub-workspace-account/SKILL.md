---
name: deskohub-workspace-account
description: Workspace customer account, Better Auth, magic link, auth persistence, profile, account deletion, and reservation history handling.
---

# Workspace customer accounts

## Identity boundary

- Better Auth runs inside the Workspace application on the existing
  branch-specific Neon database. Do not add a second auth database, a managed
  auth service, legacy Stack Auth, or a generic auth provider abstraction.
- Better Auth owns the customer account: immutable login email, verification,
  sessions, and magic-link credentials. Its tables live in the dedicated
  `auth` PostgreSQL schema. Dotypos owns the customer profile: required first
  name, optional last name, optional phone, optional personal or business
  billing, and live reservation facts.
- Workspace stores only the one-to-one opaque ID mapping in
  `public.customer_account_links`. Never persist another copy of profile data
  or duplicate auth data elsewhere.

## Persistence

- Keep Drizzle as the only migration authority. Generate the auth tables and
  `customer_account_links` with Drizzle tooling from the checked-in schema;
  never apply Better Auth runtime migrations and never hand-edit snapshots.
- Feed Better Auth from the existing singleton `pg.Pool` through the
  conventional node-postgres Drizzle facade and the Relations-v2 adapter with
  `schemaName: "auth"`. Never create, attach, or close a second pool, and
  never pass the Effect Drizzle client to Better Auth.
- Keep the connectionless auth options module as the single source of
  table-shaping choices (`rate_limit` storage, `deletionRequestedAt`, session
  fields) shared by schema generation and the runtime auth instance.
- Keep Better Auth model names and schema types private to the account and
  database boundary. Domain code sees only `CustomerAccountId` and
  `DotyposCustomerId`.
- Timestamps decode as `Date` for Better Auth; keep `timestamptz` columns and
  the cleanup indexes on `session.expires_at`, `verification.expires_at`, and
  `rate_limit.last_request`. The daily cleanup deletes expired session,
  verification, and rate-limit rows with ordinary set-based SQL.
- Protected production-derived Neon preview branches may inherit Better Auth
  login email, pending-verification email, and short-lived rate-limit IP keys.
  Preview fixtures and all Dotypos profile and reservation data stay synthetic;
  no sanitizer and no alternate branch procedure.

## Resolution contract

- Keep `CustomerAccountResolver` as the public, replaceable
  identity-to-customer capability for authenticated route composition and
  provider-independent tests. `resolveCurrentCustomerAccount()` is the
  Live-wired page convenience. Both return only `CustomerAccountId` and
  `DotyposCustomerId`, without exposing session or profile data.
- Require the authoritative current session and verified email. Resolve the
  profile in a fixed order: an existing durable link wins; one unique active
  exact-email profile links; one unique expired profile reserves the link and
  clears its expiration; no match requires profile completion and creates a
  Dotypos profile only afterward; ambiguous, deleted, unusable, or
  already-claimed profiles return the common support state.
- Claim links with database uniqueness and conflict rereads so same-account
  races are idempotent and a customer claimed by another account is rejected.
- Keep authentication-not-configured, unauthenticated, unverified-email,
  link-required, and unavailable as a closed public error contract. Attach only
  fixed, non-PII internal failure codes so Auth, link reads, Dotypos lookup,
  claims, locks, and deletion remain distinguishable in operator logs. Never
  retain raw provider or database failures as account error causes.
- Do not create a Dotypos customer from Auth data; Dotypos customer creation
  requires additional contact input.

## Routes, profile, and deletion

- Serve Better Auth through its official GET/POST handler at
  `/api/auth/[...all]` with `Cache-Control: private, no-store`, and keep every
  page and Server Action re-checking the authoritative database session; the
  proxy and cookies are not the authorization boundary.
- Use a single magic-link form for sign-in and implicit sign-up. Configure
  hashed token storage and keep the bearer URL out of logs, traces, and
  provider metadata.
- Render account and auth pages dynamically. The profile is Dotypos state:
  completion and edits update the required first name and the optional last
  name, phone, and personal or business billing there, never the auth user.
  The verified login email is immutable because it is the reservation-linking
  trust boundary; profile input never accepts an email.
- Run deletion only through Better Auth's public delete endpoint; it is the
  sole identity-deletion path. Require explicit destructive confirmation in
  the UI, then let the endpoint's `beforeDelete` hook take the account
  advisory lock, persist the `deletionRequestedAt` marker, and expire the
  linked Dotypos profile with a fresh ETag under the lock. Tolerate a
  definitively missing or deleted provider profile, and throw on a retryable
  provider failure before Better Auth removes the identity rows; the link row
  is then removed by its cascade. Serialize resolution, profile edits, and
  deletion with the advisory lock and re-read authority inside the lock. The
  marker blocks profile, reservation, checkout, and resolver activity but
  permits reauthentication, logout, and delete retry. Never delete retained
  Dotypos reservations, payments, invoices, or legal evidence.

## Protected-preview E2E

- Run account E2E against the immutable protected Vercel preview for the exact
  SHA and its matching Neon branch. Never use a separate auth database, a
  static preview URL, or a runtime bypass.
- Retrieve magic links through the isolated synthetic Resend tenant with
  send-only deployed authority and retrieval authority for trusted exact-SHA
  runs only. Use synthetic recipients; keep links and tokens in memory,
  register them with the E2E redactor, and never expose the production email
  credential. No tunnels and no webhook capture.
- The Playwright lifecycle must cover anonymous protection, invalid and
  replayed links, no-match profile completion, profile updates with immutable
  email, active and expired profile linking, the support state, current and
  past history, current-device logout and returning login, stale-session
  reauthentication, confirmation-gated deletion, provider-first expiration,
  session and link removal, and fresh sign-up after deletion.
- Keep provider-independent Postgres tests for same-account convergence, two
  accounts claiming one Dotypos customer, deletion racing resolution, and
  timestamp decoding. Run them against the migrated disposable database so
  cascades, unique constraints, and the real advisory lock are all exercised.
- Missing credentials may block the completion gate; do not add a runtime
  bypass while they are absent.

## Deployment checklist

- Add only environment-scoped auth secrets and mail authority to the existing
  Vercel, Neon, Resend, and cron paths. Configure fail-closed
  `BETTER_AUTH_SECRETS`, trusted-host allowlists, and send-only production
  mail per environment; never derive a secret from a public deployment
  identifier.
- Release additively: stage the build, migrate the branch, then promote. Roll
  back code without reversing account data.

## References

- [Better Auth replacement inventory](references/better-auth-replacement-inventory.md)
- [Customer-account stack dependencies](references/customer-account-stack-dependencies.md)
- [Better Auth integration and security constraints](references/better-auth-integration-security.md)
- [Magic-link delivery and protected-preview retrieval](references/magic-link-delivery-preview-retrieval.md)
- [Customer-account data retention contract](references/auth-data-retention-contract.md)
- [Better Auth data minimization in Neon](references/better-auth-pii-minimization.md)
- [Neon preview branches containing authentication PII](references/neon-preview-branch-pii-controls.md)
- https://better-auth.com/docs/integrations/next
- https://better-auth.com/docs/adapters/drizzle
- https://better-auth.com/docs/plugins/magic-link
- https://better-auth.com/docs/concepts/database
