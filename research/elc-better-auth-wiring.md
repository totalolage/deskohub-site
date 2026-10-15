# Better Auth wiring for link and code in one email (#601)

Research for map #599. Product behaviour is open in #600. This note covers only the server and Better Auth wiring.

Sources: Better Auth 1.7.2 `dist/` in the Bun cache (`~/.bun/install/cache/better-auth@1.7.2@@@1/dist`, paths below are relative to it), `@better-auth/core@1.7.2` `src/`, and the Workspace app at `d1a7a980e` (paths relative to `apps/deskohub-workspace`). Line numbers are from those revisions.

## Recommendation in one paragraph

Add the stock `emailOTP` plugin with `storeOTP: "hashed"`. Disable all of its HTTP endpoints except `/sign-in/email-otp`. Keep `/sign-in/magic-link` as the only send path. Its existing `before` hook evaluates `login_email_code` once and writes the decision into the request body's `metadata`. `sendMagicLink` reads that decision. When it is on, `sendMagicLink` deletes any earlier code row for the email, calls the server-only `auth.api.createVerificationOTP`, and passes the code to the same delivery call as the link. An `after` hook returns the decision in the `/sign-in/magic-link` response, so the screen and the email follow one evaluation. The guard, locale seeding and accounts gate are extended to `/sign-in/email-otp`. A per-email issuance cap should be added before rollout: Better Auth limits only by IP.

## 1. Where the code is created

### Facts

- `emailOTP` defaults: 6 digits, 300 s, 3 attempts, `storeOTP: "plain"`, `resendStrategy: "rotate"`, `disableSignUp: false`, rate limit 3 per 60 s on each of its paths (`plugins/email-otp/index.mjs:11-17,75-103`, `types.d.mts:11-106`). `storeOTP: "hashed"` is supported; sign-in verifies hashes through `verifyStoredOTP` (`otp-token.mjs:16-24`). Hashed codes can't be read back with `getVerificationOTP` (`routes.mjs:187-197`) or reused (`resendStrategy: "reuse"` needs a recoverable value, `otp-token.mjs:43-52`).
- `createVerificationOTP` is server-only (no HTTP path). It generates a code, stores it under `${type}-otp-${email}` with value `${stored}:0`, and returns the plain code without sending (`routes.mjs:122-145`, `utils.mjs:4-6`). It lowercases the email. The magic-link plugin does not (`plugins/magic-link/index.mjs:74`).
- Calls through `auth.api.*` run hooks but skip the router's `onRequest`, so neither `disabledPaths` nor rate limiting applies to them (`api/index.mjs:163-178`). The HTTP `/sign-in/magic-link` request that triggers `sendMagicLink` stays rate limited.
- The core option `verification.storeIdentifier: "hashed"`, already set in `auth-options.ts`, also hashes `sign-in-otp-<email>` identifiers (`@better-auth/core/src/types/init-options.ts:1317-1342`, `db/verification-token-storage.mjs:4-23`).
- `sendMagicLink({ email, url, token, metadata }, ctx)` runs after the link row is stored and before `{ status: true }` is returned (`plugins/magic-link/index.mjs:74-98`). `ctx.context.internalAdapter` is available there.

### better-auth#10437 against 1.7.2

The issue reports duplicate rows from rotate-on-resend. Its cause is present in 1.7.2. `resolveOTP` inserts first and deletes only when the insert throws, and `verification.identifier` has no unique constraint, so the insert never throws (`routes.mjs:42-53`, `db/internal-adapter.mjs:873-879`). `createVerificationOTP` inserts with no cleanup at all (`routes.mjs:139-144`). The fix, better-auth#10443, was open and unmerged when checked.

Duplicates don't make old codes valid. `consumeVerificationValue` takes the newest row by `createdAt` under a lock, consumes it, then deletes every row with that identifier (`db/internal-adapter.mjs:818-852`). A wrong guess recreates only the newest row, with attempts + 1 and its original expiry (`routes.mjs:770-782`). Stale rows sit in the table until a sign-in or the cleanup cron removes them.

### Options

| Option | One email | Rate limits | Hashed storage | Duplicate rows | Cost |
| --- | --- | --- | --- | --- | --- |
| **A. `emailOTP` + `createVerificationOTP` inside `sendMagicLink` (recommended)** | Yes, one delivery call | Send stays on `/sign-in/magic-link` (5 / 600 s / IP); verify gets the plugin rule | `storeOTP: "hashed"` + existing hashed identifiers | None if `deleteVerificationByIdentifier("sign-in-otp-<lowercased email>")` runs first. A concurrent double submit can still leave one stale row, which can't sign in. | Small. `sendVerificationOTP` is a required option; make it fail with a fixed code because its HTTP path is disabled. Calling `auth.api` from inside the auth config needs a lazy reference to the singleton. |
| B. `emailOTP` with its own `/email-otp/send-verification-otp`, link added in `sendVerificationOTP` | Yes | Two send paths to align | Yes | Has #10437 | The magic-link token would have to be minted outside its plugin. Worse than A. |
| C. Custom "send sign-in email" plugin that creates both | Yes | Must be rebuilt | Must be rebuilt | Under our control | Reimplements token and OTP storage, verify, attempts and locking. Only worth it if #600 needs several live codes per email (see 2). |

Rejected: a Server Action that calls `auth.api.signInMagicLink`. It would bypass IP rate limiting (see above).

### Plugin configuration for A

- `emailOTP({ storeOTP: "hashed", expiresIn: <#600>, otpLength: <#600>, allowedAttempts: <#600>, sendVerificationOTP: <fails> })`, placed before `nextCookies()`. Keep `disableSignUp: false` for parity with magic link (it auto-creates users, `plugins/magic-link/index.mjs` verify). Set it to `true` only if #600 decides sign-up must use the link.
- Add to `disabledPaths`: `/email-otp/send-verification-otp`, `/email-otp/check-verification-otp`, `/email-otp/verify-email`, `/email-otp/request-password-reset`, `/forget-password/email-otp`, `/email-otp/reset-password`, `/email-otp/request-email-change`, `/email-otp/change-email` (`routes.mjs:75-699`). `disabledPaths` returns 404 at the router only (`api/index.mjs:164-166`), so `auth.api.createVerificationOTP` keeps working. `check-verification-otp` must go: it verifies without consuming (`routes.mjs:240-255`) and would be a second guessing oracle.
- Lifetime: today the link lives 600 s and the plugin default is 300 s for codes. Set both to the same value unless #600 decides otherwise.

## 2. Invalidating siblings and older codes

Storage facts:
- Link row: identifier = hashed token, value = `{"email","name"}` JSON, single use (`plugins/magic-link/index.mjs:76-84`).
- Code row: identifier = hashed `sign-in-otp-<email>`, value = `<hash>:<attempts>`.
- The two rows share no key.

| #600 rule | Native 1.7.2 | How to get it | Cost |
| --- | --- | --- | --- |
| Resend invalidates older codes | Already true in effect: only the newest row can verify, and any verify attempt deletes the rest | Delete-before-create in `sendMagicLink` (also removes #10437 duplicates) | One delete per send |
| Resend keeps older codes valid | Not possible: one identifier per email, newest wins | Option C, with per-code identifiers | A custom plugin, plus own attempt accounting |
| Using the link invalidates the code | No | `hooks.after` matching `ctx.path === "/magic-link/verify"` with `ctx.context.newSession`: `internalAdapter.deleteVerificationByIdentifier("sign-in-otp-" + email.toLowerCase())` (`api/dispatch.mjs:135-168`, `cookies/index.mjs:167-180`) | One delete per link sign-in, all through the adapter |
| Using the code invalidates the link | No. The code path doesn't know the link token. | (a) At send time, store a sibling row `sign-in-link-<email>` → stored link identifier; on `/sign-in/email-otp` success, delete both. (b) Delete link rows by the email in `value` with SQL on `auth.verification`. | (a) one extra row per send, all through `internalAdapter`; it relies on how `storeToken: "hashed"` and `storeIdentifier: "hashed"` stack, which needs a test against real Postgres. (b) bypasses Better Auth and depends on the value's JSON format; reject. |
| Resend invalidates older links | No: every link is its own row | Same as the previous row, (a) | Same |
| Neither invalidates the other | Default | Nothing | Zero. A leftover link or code expires within its lifetime. |

If #600 wants full mutual invalidation, use the after hook for link → code. Use the sibling row (a) for code → link and for resend → older links, or accept up to one lifetime of overlap. Every option keeps the attempt counter per code.

## 3. Flag gating and screen agreement

Facts:
- `WorkspaceFeatureFlagService.isEnabled(key)` reads the request subject through Next `headers()` (`features/feature-flags/backend/subject.ts:18-38`).
- The Better Auth `before` hook already evaluates the accounts flag inside the `/api/auth/[...all]` route handler (`auth-server.ts:163-171,252-259`), so a request-scoped flag read works there.
- A `before` hook may return `{ context: { body } }`, which is deep-merged into the endpoint context (`api/dispatch.mjs:64-100`). An `after` hook's returned response replaces the endpoint's (`api/dispatch.mjs:239-244`).
- `metadata` passes through to `sendMagicLink` unchanged (`plugins/magic-link/index.mjs:18,74,93-98`).

Options:

1. **The sign-in request decides and returns the decision (recommended).** In `guardAuthRequest` for `/sign-in/magic-link`, evaluate `login_email_code` once and overwrite `body.metadata.signInCode` with the server's value, discarding any client value. `sendMagicLink` issues a code only when that value is true. An `after` hook on that path returns `{ status: true, signInCode }`, and the client decodes it with a schema before choosing the code screen. One evaluation drives the email and the screen. The only disagreement left: code creation fails after the decision. Then deliver link-only and log a fixed code; the screen must always say the link works too.
2. Decide on page render and evaluate again in the send path. This matches the page-gate pattern, but it is two evaluations, and a flag change or PostHog error between render and submit splits them. The worse case is a code screen with no code in the email.
3. Decide on page render and send the decision in `metadata`. The client then controls whether a code is issued, so the server must still check the flag. That brings back the split from option 2.

Gate `/sign-in/email-otp` itself on the accounts flag only (add it to `accountMagicLinkPaths`, `auth-server.ts:68-71`), not on `login_email_code`. Codes exist only when the flag was on at send time. Codes already sent keep working through a flag flip or a PostHog outage, and turning the flag off stops new codes at once. The longest exposure is one code lifetime.

PostHog distinct IDs:
- With analytics consent, the browser's anonymous ID is synced into `dh_ph_distinct_id`, and the server reads it (`features/cookie-consent/utils/posthog-identity.ts:142-150`, `shared/backend/analytics/posthog-request-context.ts:65-139`).
- Without consent, every request evaluates as the fixed subject `deskohub-workspace:global-release` (`subject.ts:13-16,50-56`).
- So a percentage rollout puts all non-consenting visitors in one bucket: all on or all off.
- After sign-in the ID becomes `workspace-account:<id>`. Sign-in happens before that, so the anonymous ID applies.
- The rollout should be planned as 0/100 for non-consenting traffic, or the flag should be released by the global subject.

Fail closed: follow `account-feature-flag.service.ts:17-29`. Only `true` enables. An explicit `false` is silent. An omitted value or error logs `unavailable` and returns `false`, which gives today's link-only email and screen.

## 4. Parity of `/sign-in/email-otp` with the magic-link path

| Concern | Magic link today | `/sign-in/email-otp` as shipped | Needed |
| --- | --- | --- | --- |
| Accounts gate | `before` hook on its paths | Not covered | Add path to `accountMagicLinkPaths` |
| Profile field injection | `name`/`image` rejected on `/sign-in/magic-link` (`auth-server.ts:173-185`) | Body is `{email, otp, name?, image?} & record<any>`; `name`, `image` and extra user fields go to `createUser` (`routes.mjs:362-418`) | Reject every body key except `email`, `otp`, `callbackURL` on this path. `locale` (`input: false`) already throws in `parseInputData` (`db/schema.mjs:63-72`). |
| New-user locale | `user.create.before` reads `ctx.query.callbackURL` on GET verify (`auth-server.ts:107-119,296-309`) | POST with no query, so it falls back to `defaultLocale`; session-time capture is also lost | Client sends `callbackURL: /<locale>/auth/callback` in the body; extend `callbackLocaleFromAuthContext` to read `ctx.body.callbackURL`. Extra body keys pass through `parseUserInput` unused. Confirm in a hook test. |
| Session cookie | Set on the GET redirect | `setSessionCookie` on the JSON response (`routes.mjs:419-447`) | Nothing: the browser calls the route directly. `nextCookies` only acts on non-router calls (`integrations/next-js.mjs:72-100`). |
| Callback / return-to | Redirect to `/<locale>/auth/callback?attempt=…` (`auth-return.ts:154-209`) | No callback handling; returns `{token, user}` | On success the client navigates to the same callback URL, so `auth/callback/page.tsx` keeps the session check, attempt handoff and locale redirect |
| Dotypos profile link | Lazy on first account page (`page-data.server.ts:281-307`, `customer-account-resolver.service.ts:92-159`) | Same | Nothing |
| Unverified existing user | Verified on link use | `revokeUnprovenAccountAccess` promotes (`routes.mjs:432-446`) | Nothing |
| BotID | None on auth routes (`instrumentation-client.ts:7-35`) | None | Recommend `checkBotId` in the guard for `/sign-in/email-otp` (guessing) and `/sign-in/magic-link` (email bombing), with both added to the client protect list. Production only, as elsewhere. Optional, but it is the cheapest per-email abuse control we have. |

`databaseHooks.user.create` and `session.create` run for plugin-created users and sessions (`db/internal-adapter.mjs:141-169,248-320`), so IP and user-agent stay null.

## 5. Rate limits and brute force

- Resolution order is the core special rule (`/sign-in/*` 3 per 10 s), then the first plugin rule that matches, then `customRules` (`api/rate-limiter/index.mjs:234-281`). The key is `IP|path`, with the IP taken from `x-vercel-forwarded-for` (`auth-options.ts`). Storage is the database.
- Verify: 3 per 60 s per IP (plugin default), plus 3 wrong guesses per code before the row is consumed (`TOO_MANY_ATTEMPTS`; later tries get `INVALID_OTP` because the row is gone).
- Send: 5 per 600 s per IP (`betterAuthMagicLinkOptions`).
- One IP gets at most 5 codes × 3 guesses = 15 guesses per 10 minutes. Against 10^6 six-digit codes that is 1.5 × 10^-5 per 10 minutes.
- Nothing is keyed by email. With many IPs, an attacker gets 3 guesses for every code issued, and every issue emails the victim. 10,000 issued codes give about 3 %.
- To bound it, add a per-email issuance cap (for example in the `/sign-in/magic-link` guard, keyed by a hash of the lowercased email in the Workspace database). A longer code, a lower `allowedAttempts`, or BotID also help. Better Auth `customRules` can't key by email.

## 6. Preview E2E

- The gated `account.magic-link.preview-e2e` line already logs the full rendered plain-text body for exact synthetic recipients on Preview (`send-magic-link-email.ts:78-114`, `magic-link-policy.ts:1-17`). Putting the code in the same email's text puts it in that log line with no new logging.
- Give the code a stable plain-text anchor (its own line). Add a code extractor next to the link extractor in `e2e/account/vercel-log-retrieval.ts:848-898`.
- Add the code to the development log line, which logs the URL today.
- Turning the flag on for E2E needs `login_email_code` in the generated contract and a branch-scoped Preview `POSTHOG_FEATURE_FLAG_OVERRIDES` entry. Overrides apply to the whole deployment, so one preview run covers one flag state. Unit tests must cover the other.

## Open dependencies on #600

- Code length, alphabet and lifetime. These set `otpLength`, `expiresIn` (match the link's 600 s or not) and the brute-force numbers.
- Attempts per code (`allowedAttempts`).
- Link ↔ code invalidation and resend rules. These choose rows in section 2; only "older codes stay valid" forces option C.
- Sign-up by code (`disableSignUp`).
- Whether a per-email cap and BotID are in scope for this PR.

## Uncertainties

- `ctx.body.callbackURL` being visible to `databaseHooks.user.create.before` on `/sign-in/email-otp` is inferred from the hook context shape, not tested.
- Stacking `storeToken: "hashed"` with `storeIdentifier: "hashed"` for sibling row (a) needs a Postgres test before relying on it.
- Calling `auth.api.createVerificationOTP` from inside `sendMagicLink` needs a lazy reference to the `betterAuth` singleton. No recursion guard is involved, but the module-cycle shape should be checked.
- The per-email cap design (table, window) is not researched here.
