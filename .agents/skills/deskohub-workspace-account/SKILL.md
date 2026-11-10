---
name: deskohub-workspace-account
description: Workspace customer account, current customer account standing, CurrentCustomerAccount, Better Auth, magic link, sign-in, session, auth persistence, customer account link, durable customer account, customer_accounts, deleted-account tombstone, reservation author storage, profile, avatar, account deletion, account data export, reservation history, /account/legal preferences, account analytics preference, analytics opt-out, saved language preference, signed-in locale, auth retention or PII, PostHog identity, OAuth server, MCP authorization, customer HTTP API, /api/customer, AI agent or assistant connection, consent page, CIMD, access token, well-known discovery, data transfers outside the EU, third-country transfer, DPF, SCC, provider region.
---

# Workspace customer accounts

Paths are relative to `apps/deskohub-workspace` unless they start with
`packages/`. The repository root holds `lint/` and `biome.json`.

## Ownership boundary

- Better Auth runs inside the Workspace app on the existing branch-specific
  Neon database, in the `auth` PostgreSQL schema. It owns the immutable login
  email, verification, sessions, and magic-link credentials. Don't add a second
  auth database, a managed auth service, or a generic auth provider
  abstraction.
- Dotypos owns the customer profile (required first name, optional last name,
  phone, and personal or business billing) and live reservation facts.
- Workspace stores only the durable customer account in
  `public.customer_accounts` (id, the opaque id of its own Dotypos customer,
  and deletion instant; see
  [durable customer account](references/account-domain-and-routes.md#durable-customer-account)). Never
  copy profile or auth data anywhere else. The one exception is an administrator account actor: records an
  administrator writes keep the account's login-email snapshot as provenance
  (see the `deskohub-workspace-administration` skill's `dhw` reference).
- Domain code sees only `CustomerAccountId` and `DotyposCustomerId` through the
  exports of `features/account/index.ts`. Keep Better Auth types and names
  inside the auth boundary; `lint/no-better-auth-in-account-domain.grit` and the
  account `noRestrictedImports` override in `biome.json` enforce this.

## Always-apply rules

- Re-check the authoritative database session in every page, route, and
  Server Action. The proxy cookie check and cookies are not the authorization
  boundary.
- Keep magic-link URLs, tokens, emails, cookies, and raw provider or database
  failures out of logs, traces, errors, and analytics. Log fixed non-PII codes.
  The only exceptions are the two gated magic-link lines in
  [magic-link delivery](references/magic-link-delivery-and-e2e.md).
- Serialize account mutations in a customer account section
  (`CustomerAccountSections`, `features/account/backend/customer-account-sections.ts`),
  the only way to take the account lock. `withActiveAccount(accountId, work, { recheck })`
  holds the lock on its own connection, rechecks the account once under it,
  and provides `HeldCustomerAccount` (`{ accountId, email }`) to the work.
  Recheck `session` (the default: the session is this account's, and the
  account exists without a deletion marker), `active` (the account exists
  without a marker; no session read), or `present` (a marker is tolerated;
  deletion only, so its retry works). The lock's own failure is
  `unavailable` (`account-link.lock`); the work's failures pass through.
  `withOptionalAccount` runs reservation and checkout state creation held for
  a signed-in session and unlocked for an anonymous one.
- Enter a section outside every Workspace transaction. A section inside a
  section for the same account reuses the hold without a second recheck, so
  services that lock themselves compose; a step that must run held declares
  `HeldCustomerAccount` in its requirements, never a name suffix. Under
  `withOptionalAccount`, read the contact with
  `CustomerAccountContactService.current` or the standing with
  `CurrentCustomerAccount.peek`, and never resolve through
  `CustomerAccountResolver` or `CurrentCustomerAccount.resolve`.
- Keep Drizzle as the only migration authority. Never run Better Auth runtime
  migrations.
- Prefer Better Auth, Effect, and Next built-in APIs over hand-rolled
  equivalents. For example, use Better Auth `getSessionCookie` for the
  optimistic cookie check and `CustomerAuthentication` for session reads;
  never parse the session cookie or query `auth.session` yourself.
- Passkey sign-in is the exception: start it through `signInWithPasskey`,
  which runs `requestPasskeySignIn` (`features/account/passkey-sign-in.ts`),
  never `authClient.signIn.passkey`. The plugin call can't be cancelled, so
  a late autofill attempt aborts the button's ceremony or replaces its
  challenge cookie. Reauthentication keeps the plugin call.
- Preview databases follow the Neon preview-branch PII rule in the root
  `AGENTS.md`. Keep every fixture, E2E identity, and Dotypos record synthetic.

## References

Read the reference that matches your change before editing:

- [Account domain and routes](references/account-domain-and-routes.md):
  account standing (`CurrentCustomerAccount`), customer resolution, link claims, the durable customer account and
  reservation authors, the public error contract, account pages
  and modals, the `/account/legal` preferences (account analytics
  preference, opt-out, cross-device withdrawal), header sign-in state,
  profile edits, and deletion.
- [Account data export](references/account-data-export.md): the
  `/account/data-export` ZIP archive, its section owner reads, export policy
  limits, failure codes, route responses, and tests.
- [Better Auth configuration](references/better-auth-configuration.md):
  persistence, adapter and pool, schema generation, session, magic-link and
  rate-limit settings, PII minimization, hosts, secrets, cleanup cron, and
  release.
- [Saved language preference](references/locale-preference.md): the `locale`
  user field, signed-in locale resolution in the proxy and Server Actions,
  locale-bound continuations, and email language.
- [Magic-link delivery and account E2E](references/magic-link-delivery-and-e2e.md):
  email routing, the Preview and development log lines, Vercel log retrieval,
  and required account test coverage.
- [Customer agent OAuth](references/customer-agent-oauth.md): the OAuth
  2.1 server for customers' AI agents, discovery routes, the connect and
  consent pages, the token-to-customer adapter, revocation, and cleanup.
- [Privacy and retention](references/privacy-and-retention.md): what each
  system retains, the transfers-outside-the-EU inventory, Neon preview copies,
  Resend, Dotypos expiry, and privacy-copy obligations.
- [Customer HTTP API](references/customer-http-api.md): adding an endpoint
  to `/api/customer` and `@deskohub/workspace-customer-api` (the native app's
  API), its handler group, budget class, origin and client-header checks,
  error mapping, and the OpenAPI golden.
- The native app's side of sign-in, passkey origins per environment, the
  association files, and app analytics: the `deskohub-mobile` skill
  (`references/auth-and-passkeys.md`, `references/analytics.md`).
- [Avatar media storage](references/avatar-media-storage.md): Cloudinary
  staging, promotion, recovery, and deletion ordering.
- [PostHog identity and privacy](references/posthog-identity-privacy.md):
  analytics consent, identity transitions, event and property limits, flag
  requests, ingest host isolation, and the Dotypos customer warehouse source.

Upstream docs: [Next.js integration](https://better-auth.com/docs/integrations/next),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[magic link](https://better-auth.com/docs/plugins/magic-link),
[database](https://better-auth.com/docs/concepts/database).
