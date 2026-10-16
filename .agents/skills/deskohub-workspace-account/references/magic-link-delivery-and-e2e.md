# Magic-link delivery and account E2E

## Delivery path

- Better Auth calls `workspaceSendMagicLink` (`auth-server.ts`) with the email,
  token, bearer URL, and, while sign-in codes are on, the code. It picks the
  email language from the saved preference, else `metadata.locale`, then
  delivers in Next `after()` so the response doesn't depend on delivery timing
  or account existence.
- The template (`magic-link-email.tsx`) shows the code under the button as two
  spans that read `482 913`, with intro copy and an expiry note. The text body
  keeps the code alone on one bare six-digit line, the only such line, which
  the E2E extractor relies on.
- `makeMagicLinkEmailDelivery` (`features/account/backend/auth/send-magic-link-email.ts`)
  sends through the shared `@deskohub/email` `EmailServiceTag.RecipientRouted`
  service, which owns sending, retry, and routing for every Workspace email:
  mail addressed only to `EMAIL_TEST_DOMAIN` recipients goes to Console, and
  everything else, including Resend's `resend.dev` simulator, goes to Resend.
- Mark every magic-link message `sensitiveContent`, so Console output
  suppresses the bearer content. Delivery reports only the fixed
  `account.magic-link.delivery-*` codes.
- `EMAIL_API_KEY` is required in Production and Preview. Only development may
  omit it, and then every message, real recipients included, goes to Console
  with bearer content suppressed. There's no provider selection setting.
- Use a sending-only, domain-scoped Resend key in Production. Never make
  production message-retrieval credentials available to CI.
- Auth owns the template, the synthetic-recipient pattern
  (`features/account/backend/auth/magic-link-policy.ts`), and the gated log
  lines. Don't loosen the shared Console provider; Boardgame Bar uses it too.
- Keep open and link tracking off for auth email, and put no profile,
  reservation, billing, or Dotypos identifiers in the subject, body, or tags.

## The two authorized bearer-link log lines

These are the only exceptions to the no-bearer-material logging rule.
`emitAuthorizedMagicLinkLine` is the only `console.log` in the account backend,
and `features/account/backend/account-boundary.test.ts` enforces that.
`magicLinkDeliveryEnvironment` derives both conditions.

| Line | Emitted when | Content |
| --- | --- | --- |
| `account.magic-link.preview-e2e` | Runtime is Vercel Preview, the recipient matches `delivered+<run-id>-<label>@<EMAIL_TEST_DOMAIN>` exactly, and Console accepted the send | Rendered TEXT body with the link and any sign-in code |
| `account.magic-link.development` | `VERCEL_ENV` and `NODE_ENV` are both `development` (only `next dev`; Vercel builds run `production`, `bun test` runs `test`) and Console accepted the send | Recipient, bearer URL, and any `signInCode` |

Both lines bypass the Effect/OTel censorship layer on purpose. Links delivered
through Resend are never printed. Never extend either line to real Preview
recipients or Production.

## Preview link retrieval

The account E2E runner (`e2e/account/vercel-log-retrieval.ts`) reads the
Preview line from Vercel runtime logs:

- It authenticates with `WORKSPACE_E2E_VERCEL_TOKEN`, which lives only in the
  protected `workspace-checkout-e2e` GitHub environment and never enters Vercel
  or app configuration. Send it only as a Bearer header, never in a URL. The
  runner treats the token's scope as opaque.
- It resolves the immutable host with `GET https://api.vercel.com/v13/deployments/<host>`
  and requires the configured `projectId`.
- It queries `https://vercel.com/api/logs/request-logs`, the history route the
  pinned Vercel CLI uses. The route and its `{ rows, hasMoreRows }` response are
  an internal CLI contract, not a public API. Scope each query to the
  deployment, project, a bounded time window, and the
  `account.magic-link.preview-e2e` marker; capture baseline row IDs before each
  send; match the exact synthetic recipient; reject malformed, truncated,
  stale, or ambiguous results.
- Before navigating, resolve the logged callback against the immutable Preview
  origin: require HTTPS, the exact preview host, and the Better Auth callback
  path. Keep the `attempt` and `returnTo` query that `createAuthReturnLifecycle`
  adds; normal sign-in needs `attempt`, and a sign-in opened with `returnTo`
  lands there. `e2e/account/callback-url.ts` is the shared callback grammar.
  Deduplicate identical URLs and reject distinct matches.
- `retrieveSignInEmail` returns the link and the sign-in code from one log
  line; the code is the only line that is exactly six digits.
- Keep links, tokens, and codes in memory, and register the recipient, link,
  token, code, cookies, and log line with the E2E redactor before they can
  reach any output. Keep response bodies and row contents out of spans and failures.
- Exercise the real verification route and cookie. Never read tokens from
  Postgres, add a token-returning route, ship `testUtils`, add a runtime
  bypass, or use tunnels or webhook capture.

Lane scheduling and the magic-link rate budget live in the
`deskohub-workspace-e2e` skill.

## Account E2E

- Run account E2E against the immutable protected Vercel preview for the exact
  SHA and its matching Neon branch. Never use a separate auth database, a
  static preview URL, or a runtime bypass. Missing credentials may block the
  completion gate; don't add a bypass while they're absent.
- Keep browser diagnostics opt-in: the lane requests no automatic screenshots,
  traces, videos, HARs, or console or network diagnostics. It may capture only
  the allowlisted stable-page PNGs in `e2e/account/review-screenshots.ts` from
  its synthetic context. Validate fixed page paths before capture and upload
  PNGs only.
- The Playwright lane (`e2e/account/account-lane.pw.ts`) must cover:
  anonymous protection, invalid and replayed links, no-match profile
  completion, profile updates with immutable email, active and expired profile
  linking, the support state, current and past history, current-device logout
  and returning login, stale-session reauthentication, confirmation-gated
  deletion, provider-first expiration, session and link removal, and fresh
  sign-up after deletion.
- Keep provider-independent Postgres tests (`*.postgres.test.ts`) for
  same-account convergence, two accounts claiming one Dotypos customer,
  deletion racing resolution, and timestamp decoding. Run them against the
  migrated disposable database so cascades, unique constraints, and the real
  advisory lock are exercised.
