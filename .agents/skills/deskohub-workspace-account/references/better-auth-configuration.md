# Better Auth configuration

## Where things live

| Concern | Location |
| --- | --- |
| Connectionless options shared by schema generation and runtime | `features/account/backend/auth/auth-options.ts` |
| Runtime instance, hooks, plugins, delivery wiring | `features/account/backend/auth/auth-server.ts` |
| Server singleton | `features/account/server/auth.server.ts` |
| Browser client (the only allowed `better-auth/client` import) | `features/account/auth.client.ts` |
| Host allowlist, secrets parsing | `features/account/backend/auth/auth-hosts.ts`, `auth-secrets.ts` |
| Drizzle auth schema and its test | `db/schema/auth.ts`, `db/schema/auth.test.ts` |
| node-postgres facade over the shared pool | `db/auth-database-client.ts` |
| Expired-row cleanup | `features/account/backend/auth/auth-cleanup.service.ts`, `app/api/cron/workspace/auth-cleanup/route.ts` |
| OAuth server for customers' AI agents | [customer agent OAuth](customer-agent-oauth.md) |

## Persistence

- Feed Better Auth from the singleton `workspaceDatabasePool` through the
  node-postgres Drizzle facade (`makeAuthDatabase`) and the
  `@better-auth/drizzle-adapter/relations-v2` adapter with
  `schemaName: "auth"`. The app's Effect Drizzle client returns Effects, which
  the adapter can't await, so never pass it to Better Auth. Never create,
  attach, or close a second pool.
- `auth-options.ts` is the single source of table-shaping choices: database
  `rate_limit` storage, the `deletionRequestedAt` and `locale` user fields,
  session settings, and `advanced.database.joins`. When you add a user field
  there, update `db/schema/auth.ts` and `db/schema/auth.test.ts` in the same
  change.
- Generate the auth tables and `customer_accounts` with Drizzle tooling
  from the checked-in schema; never hand-edit snapshots. Better Auth's own
  `migrate` command doesn't apply to this setup. Follow the migration process
  in the `deskohub-workspace-operations` skill.
- Keep `timestamptz` columns (Better Auth decodes them as `Date`) and the
  cleanup indexes on `session.expires_at`, `verification.expires_at`, and
  `rate_limit.last_request`.

## Security settings

Keep these settings unless a reviewed decision changes them:

- Sessions are stored in the database with a 30-day rolling lifetime, at most
  daily refresh, and 10-minute freshness for destructive actions. Keep cookie
  caching disabled so logout, deletion, and revocation take effect on the next
  request.
- Magic links expire after 10 minutes, are consumed atomically on first use,
  and store only a hash. Both magic-link paths allow five requests per client
  IP per 10 minutes. Database rate limiting is on in every environment because
  in-memory counters don't hold across serverless instances.
- The client IP comes only from `x-vercel-forwarded-for`.
  `trustedProxyHeaders`, `disableCSRFCheck`, `disableOriginCheck`, and
  cross-subdomain cookies stay off. Cookies are host-only, `SameSite=Lax`.
- `baseURL` is the dynamic `allowedHosts` form built by `auth-hosts.ts`: the
  canonical customer-facing host, the exact Vercel project, deployment, and
  branch hosts, and `localhost:3000` in development. Wildcards fail closed.
  Don't trust arbitrary request hosts or add a fallback host.
- Password sign-in exists only for app-directory review logins, the
  `REVIEW_ACCOUNT_CREDENTIALS` allowlist (`review-account-credentials.ts`:
  JSON `[{ email, password }]`, lowercase `@deskohub.test` emails, passwords
  of 16 to 128 characters; validation errors never echo values). Sign-up is
  off, and `disabledPasswordPaths` in `auth-server.ts` blocks every reset,
  set, verify, change-password, change-email, list-accounts, and
  unlink-account route; Better Auth matches `disabledPaths` literally against
  the request path, so the guard also refuses `/reset-password/:token`. The
  `/sign-in/email` guard runs BotID, answers any address outside the
  allowlist, or any password but the configured one (constant-time), with
  Better Auth's own `INVALID_EMAIL_OR_PASSWORD` 401 before any lookup, and
  provisions an allowlisted login under `withSignInEmailLock`
  (`review-account-sign-in.ts`): a new login gets
  `ReviewAccounts.register(id)`, then `createUser` with that id, then a
  credential row shaped like Better Auth's `setPassword`; an existing review
  login gets a missing credential back or a rehash when the configured
  password changed (only the configured password triggers it, so an old
  deployment can't rehash over a rotation); an existing customer login is
  refused with the fixed
  `account.review-login.customer-login` code and the same 401. Better Auth's
  handler then checks the password. The `after` hook drops the response's
  `redirect` so the page navigates itself, as after a code. The per-IP limit
  is ten requests per 10 minutes. `/sign-in/magic-link` answers an
  allowlisted address with `{ status: true, method: "password" }` from the
  `before` hook, which ends the request: no link, code, verification row, or
  email. Passkey registration is refused for review accounts. Rotation
  residual: a deployment still configured with the old value, including an
  older deployment's own URL, accepts the old password and rehashes it back;
  review logins hold no customer data, and older deployment URLs rely on
  Vercel Deployment Protection.
- Sign-in codes (`login_email_code`): the stock `emailOTP` plugin stores a
  hashed six-digit code that lives as long as the link (600 s) and burns after
  five wrong attempts. `/sign-in/magic-link` stays the only send path: its
  `before` hook evaluates the flag once, fail closed, and overwrites
  `metadata.signInCode` (Better Auth deep-merges the hook context, so the
  browser's `metadata.locale` survives); `sendMagicLink` then, under a per-address Postgres
  advisory lock (`withSignInEmailLock`), deletes the email's older code, calls
  server-only `auth.api.createVerificationOTP`, and writes the email's claim
  row (keyed by the link token's digest) and a binding row (keyed by a digest
  of address and code) that leads to it, and replaces the address's
  current-claim row (keyed by a digest of the address) with one naming this
  claim; the code goes in the same email and the `after` hook returns
  `{ status, signInCode }`. One email is one sign-in: the link takes the claim
  in the `before` hook, before Better Auth consumes it, and the code takes it
  in `session.create.before`, after Better Auth accepts it. The claim is a
  conditional update, so only one of them wins; a losing link is deleted and
  fails as `INVALID_TOKEN`, a losing code fails as `INVALID_OTP`. A code also
  fails as `INVALID_OTP` unless its claim is the current one. Deleting the
  older OTP row isn't enough on its own: on a wrong guess Better Auth consumes
  the code and writes it back outside the lock, which can restore a replaced
  code. Its verify reads only the newest code row and deletes the rest, so
  `verification.create.before` dates a written-back code at its issue
  (`expiresAt` minus `expiresIn`). A late write-back of an older code then
  can't displace the newer one. The known residual: clock skew between
  instances wider than the gap between two emails can still let the older
  code displace the newer one. That fails safe, with no session from either
  code, and a new email restores sign-in; a test pins it. Older links keep their claims and still sign in once. A link without
  a claim row (sent while codes were off) signs in as before. Claim storage failures fail the request; never swallow them,
  since a swallowed link revocation lets both halves sign in. Every other
  email-OTP path is in `disabledPaths`. Code sign-in accepts only `email`, `otp`, and
  `callbackURL`, seeds a new account's locale from that callback, is always
  BotID-checked, and allows ten requests per IP per 10 minutes. Every sign-in
  email send is BotID-checked, matching the client `protect` list. While the
  flag is on, sends are also capped at five per address per rolling
  hour (`SIGN_IN_EMAIL_LIMIT_REACHED`, 429), one verification row per send
  keyed by a digest of the address. Logic: `sign-in-code.ts`.
- The browser side is `features/account/auth-return.ts`. It sends
  `metadata: { locale }`, shows the code step when the response's `signInCode`
  is `true`, and signs in through `signIn.emailOtp` with only the email, code,
  and the callback URL it sent the link with. It maps 429
  `SIGN_IN_EMAIL_LIMIT_REACHED` to the per-address limit, any other 429 to the
  rate limit, and `INVALID_OTP`, `OTP_EXPIRED`, and `TOO_MANY_ATTEMPTS` to
  code rejections. `BOT_DETECTED` (403) maps to `automated`, which tells the
  customer to continue in their own browser. Everything else, including 503,
  is a generic failure.
- `nextCookies()` must stay the last plugin; it forwards Server Action
  `Set-Cookie` headers.
- Better Auth's logger is disabled. `onAPIError` logs only the fixed
  `account.auth.handler` code for 5xx failures and replaces the error with a
  generic 500.
- Server-side `auth.api` calls bypass the rate limiter and `disabledPaths`.
  Send browser sign-in through the mounted endpoint, not a custom Server
  Action. A direct call made inside a request, such as
  `createVerificationOTP`, needs the request (`request`, `asResponse: false`)
  to resolve the dynamic base URL.

## PII minimization

- The `session.create.before` database hook stores `ipAddress` and
  `userAgent` as `null`. Keep IP detection enabled: the rate limiter needs it,
  and `disableIpTracking` would also disable rate limiting.
- Don't pass a name or image to Better Auth, so `auth.user.name` stays the
  empty string. Never fill `auth.user.image`; avatars live in Cloudinary.
- `auth.account` holds only review logins' credential rows (a scrypt hash on
  a synthetic `.test` login): the magic-link flow creates no account rows, and
  OAuth sign-in providers and social providers stay disabled. The
  OAuth server for AI agents is a separate concern: its client, consent, and
  token tables are covered in [customer agent OAuth](customer-agent-oauth.md).
- What remains in Neon is the login email, the email inside each pending
  verification row, raw `IP|path` rate-limit keys, and `auth.passkey` rows
  (credential ID, public key, AAGUID, and the customer-written label). Sign-in code, claim, current-claim,
  binding, and per-email send rows store only hashed identifiers and values. Better Auth has no
  native option to hash or encrypt these, so don't build a custom adapter or
  HMAC rate-limit storage to remove them.

## Cleanup cron

Better Auth only removes expired rows when a later request happens to touch
them. The daily `auth-cleanup` cron (scheduled in `vercel.json`, authorized
with `CRON_SECRET`) deletes expired sessions and verifications, rate-limit
rows older than the longest configured window, and expired agent access
tokens, refresh tokens, and client-assertion records, and clears agent
refresh replay copies whose reuse window has passed, using plain set-based
SQL. It also tombstones customer accounts whose login is gone and that are
more than a day old. It only cleans its own deployment's database.

## Secrets and release

- `BETTER_AUTH_SECRETS` is the versioned secret list: the first key signs new
  data and older keys still verify. Production env validation requires it,
  and auth bootstrap throws on an invalid value. Configure it per
  environment, and never derive a secret from a public deployment
  identifier. Give Preview a secret distinct from Production so session
  material copied into a preview branch can't pass as a production session.
- Pin `better-auth` and every `@better-auth/*` package to the same exact
  version, and treat published Better Auth advisories as patch triggers.
- Add only environment-scoped auth secrets and mail settings to the existing
  Vercel, Neon, Resend, and cron paths.
- Release additively: stage the build, migrate the branch, then promote. Roll
  back code without reversing account data.

## Test helpers

Better Auth's `testUtils` plugin can create users and sessions for focused
integration tests through a separate test-only auth instance. Never add it to
the runtime configuration. It doesn't replace the exact-preview magic-link
lifecycle in [magic-link delivery and account E2E](magic-link-delivery-and-e2e.md).
