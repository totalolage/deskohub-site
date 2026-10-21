---
name: deskohub-workspace-account
description: Workspace customer account, Better Auth, magic link, sign-in, session, auth persistence, customer account link, durable customer account, customer_accounts, deleted-account tombstone, reservation author storage, profile, avatar, account deletion, reservation history, saved language preference, signed-in locale, auth retention or PII, PostHog identity, OAuth server, MCP authorization, AI agent or assistant connection, consent page, CIMD, access token, well-known discovery, data transfers outside the EU, third-country transfer, DPF, SCC, provider region.
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
- Serialize account mutations with the account advisory lock
  (`CustomerAccountLinkRepository.withAccountLock`). The lock isn't reentrant: under
  `OptionalAccountActivityGuard`, read the contact with
  `CustomerAccountContactService.current` and never call
  `resolveCurrentCustomerAccount`.
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
  customer resolution, link claims, the durable customer account and
  reservation authors, the public error contract, account pages
  and modals, header sign-in state, profile edits, and deletion.
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
- [Avatar media storage](references/avatar-media-storage.md): Cloudinary
  staging, promotion, recovery, and deletion ordering.
- [PostHog identity and privacy](references/posthog-identity-privacy.md):
  analytics consent, identity transitions, event and property limits, flag
  requests, ingest host isolation, and the Dotypos customer warehouse source.

Upstream docs: [Next.js integration](https://better-auth.com/docs/integrations/next),
[Drizzle adapter](https://better-auth.com/docs/adapters/drizzle),
[magic link](https://better-auth.com/docs/plugins/magic-link),
[database](https://better-auth.com/docs/concepts/database).
