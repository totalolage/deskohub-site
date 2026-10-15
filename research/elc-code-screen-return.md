# Code screen: continuing when the link opens on the same device

Research for issue #602 (map #599). Base: `origin/main` at `d1a7a980e`.
Paths are relative to `apps/deskohub-workspace` unless noted.

## 1. How the `attempt` mechanism works

There is no stored attempt. The ID lives only in a closure in the original
tab's JavaScript and travels in the callback URL.

1. `SignInCard` builds one lifecycle per locale with
   `createAuthReturnLifecycle({ locale })` and cancels it on unmount:
   `useEffect(() => authReturn.cancel, [authReturn])`
   (`features/account/components/sign-in-card.tsx:70-83`).
2. `sendMagicLink` (`features/account/auth-return.ts:154-207`) checks for
   `crypto.randomUUID`, `BroadcastChannel` and `navigator.locks`. If all three
   exist, it creates a UUID v4 and calls `listenForReturn`. When the listener
   is set up, it sends
   `callbackURL = /{locale}/auth/callback?attempt=<uuid>`; otherwise it sends
   the plain `/{locale}/auth/callback`. It then calls
   `authClient.signIn.magicLink({ email, callbackURL, metadata: { locale } })`.
3. `listenForReturn` (`shared/browser/return-window.ts:187-311`) holds an
   exclusive Web Lock `deskohub:return-window:<uuid>` and opens a
   `BroadcastChannel(<uuid>)`, with a TTL of 10 minutes (`RETURN_LISTENER_TTL_MS`,
   which matches the 600 s link expiry). It doesn't poll, use `storage` events
   or listen for `visibilitychange`.
4. The link tab: Better Auth verifies the token at `/api/auth/magic-link/verify`,
   sets the session cookie and redirects to the callback page. That page checks
   the session on the server
   (`app/[locale]/(minimal-header)/auth/callback/page.tsx:34-50`). With a
   session it renders `AuthCallbackRedirect`; without one it shows the
   "link failed" card.
5. `AuthCallbackRedirect` (`features/account/components/auth-callback-redirect.tsx:9-73`)
   reads `?attempt` (and goes straight to the account page when `?error` is
   present), then calls `handOffReturn` (`return-window.ts:313-416`). The
   hand-off tries the lock with `ifAvailable`. If the lock is held, someone
   is listening, so it posts `{type:"return"}` and waits up to 1.5 s for
   `{type:"handled"}`.
6. The original tab receives `return`, calls
   `authClient.getSession({ disableCookieCache: true })`, and requires
   `emailVerified` (plus a session under 10 minutes old when
   `requireFreshSession` is set). It then runs
   `window.location.replace(/{locale}/account)`, focuses the window and posts
   `handled` (`auth-return.ts:70-128, 165-187`).
7. The link tab calls `window.close()` when the hand-off was acknowledged. If
   the hand-off wasn't acknowledged, or the close was blocked, it navigates
   to the account page itself.

Tests: `features/account/auth-return.test.ts:157-293` (listener correlation,
fallback without coordination APIs, navigating only after a verified session),
`features/account/auth-return.browser.test.ts:596-773` (real two-tab
hand-off), `shared/browser/return-window.test.ts`. `sign-in-card.test.tsx:104-138`
asserts only the plain callback URL. `e2e/account/account-lane.pw.ts:426-438`
dispatches `account-magic-link-delivery` through `withCallbackHandoffReview`.

## 2. Can the code screen reuse it unchanged?

Yes, if the code screen is the `requested` state of the same mounted
`SignInCard`. Today that state is the "Check your inbox" card
(`sign-in-card.tsx:111-135`). The listener belongs to the `authReturn` lifecycle
that the card already holds, so swapping the "Check your inbox" card for a code
form keeps it alive. Opening the link in another tab of the same browser
profile then moves the code tab to `/account` and closes the link tab. No
change to `auth-return.ts` or `return-window.ts` is needed.

| Case | Behaviour with unchanged reuse |
| --- | --- |
| Same profile, code screen still open | Auto-continues to `/account`; link tab closes or navigates. |
| Code screen reloaded | The closure and listener are gone. `handOffReturn` finds no lock holder, so the link tab goes to `/account` itself. The code tab stays on the code screen; typing the code still works. The session cookie is already set, so a typed code would sign in a second time. |
| Link opened after 10 min | Listener expired; same as reload. The link itself has also expired (600 s). |
| Different browser on the same device | Separate cookie jar and separate BroadcastChannel scope. The link tab signs in *that* browser. The code tab never learns; the customer must type the code. |
| In-app mail browser (Gmail/Outlook webviews) | Same as a different browser: the webview gets the session and the code tab stays. This is the main reason the code exists. |
| Private window vs normal window | Separate storage partitions; same as a different browser. |
| No `BroadcastChannel`/`navigator.locks` (old Safari < 15.4) | No `attempt` is sent; link tab navigates itself. |

Cheap improvement for the reload case (optional, not needed for the
same-profile case): on `visibilitychange` → visible and on `focus`, have the
code screen call the same verified-session check (`readSessionResponse` +
`hasAuthenticatedSession`) and navigate to `/account` when a session exists.
Session cookies are shared within a profile, so this covers reloads and
expired listeners without a new server endpoint. Skip polling; focus covers
the realistic case where the customer switches back from the link tab.

## 3. Route design and where the email lives

**Recommendation: a step inside `/[locale]/auth/sign-in`, not a new route.**

- A separate route needs `router.push`, which unmounts `SignInCard`.
  `authReturn.cancel` would then dispose the listener
  (`sign-in-card.tsx:83`). Keeping it alive would mean lifting the lifecycle
  into a shared layout or module singleton, which changes ownership for no
  product gain.
- A deep link to `/auth/sign-in/code` with no email would need a guard and
  redirect anyway; with a step there is nothing to deep-link.
- The proxy already marks `/auth/*` private/no-store (`proxy.ts:45-46,
  201-233`); a step inherits that.

**Where to keep the email: React state in the card, mirrored to
`sessionStorage`.**

- `signIn.emailOtp({ email, otp })` needs the email in the request body, so the
  client must have it. The email never needs to go in the URL.
- `sessionStorage` is per-tab and survives reloads, but it is not shared
  with other tabs and is dropped when the tab closes. That's the right scope.
  Store `{ email, requestedAt }` under one key and drop it once `requestedAt`
  is more than 10 minutes old, on success, and on "use a different email".
- A server cookie isn't worth it: sign-in requests go from the browser
  straight to Better Auth (`/api/auth/*`, no Server Action), so a cookie would
  need a new endpoint. Better Auth already has the email in its verification
  row.
- Reload: restore the code step from `sessionStorage` (read it after hydration,
  as `clientReady` already does at `sign-in-card.tsx:64-68`). The listener
  doesn't come back (see section 2). Missing or expired entry: show the email
  form. Deep link: no route to deep-link.
- Privacy: `sessionStorage` is client-only and never sent to analytics; keep the
  email out of PostHog properties and logs as the account skill requires.

## 4. OTP input primitives

- Workspace shadcn components live in `shared/components/ui`
  (`components.json:13-18`). There is no shared UI package with OTP, no
  `input-otp` dependency (`bun.lock`), no `InputOTP`, and no
  `autoComplete="one-time-code"` anywhere.
- Add shadcn `input-otp` through the app's `components.json` (the react-ui
  skill's rule for missing primitives); it pulls in the `input-otp` package.
  That package renders one real `<input>` behind the slots and defaults to
  `autoComplete="one-time-code"` and `inputMode="numeric"`. Paste and iOS/Android
  SMS/email code autofill work against that single input. Check the defaults
  after adding; set them explicitly if the generated component overrides them.
- Better Auth `emailOTP` defaults to six digits (`otpLength`), so use six
  slots and `pattern` digits-only (`REGEXP_ONLY_DIGITS`).

## 5. Conflicts with a second sign-in path

1. **One email, two plugins.** `magicLink` and `emailOTP` each send their own
   email. For one email with both, generate the code inside the magic-link
   send handler with the server-only
   `auth.api.createVerificationOTP({ body: { email, type: "sign-in" } })`
   (better-auth 1.7.2 `dist/plugins/email-otp/routes.mjs:122-146`) and pass it
   to `MagicLinkEmail` (today it takes only `locale` and `url`,
   `features/account/backend/auth/magic-link-email.tsx:16-19`). Don't call
   `emailOTP`'s `send-verification-otp`.
2. **Delete-account reuses the lifecycle.**
   `features/account/components/delete-account-card.tsx:54-56` calls
   `createAuthReturnLifecycle({ requireFreshSession: true })` and sends the
   same magic-link email for re-authentication. If the code is added to every
   magic-link email, re-auth emails show a code with nowhere to type it.
   Either gate the code on a sign-in flag in `metadata` or give re-auth its
   own code step.
3. **Expiry and attempt alignment.** Link expires at 600 s and the listener's
   TTL is 600 s; `emailOTP` defaults to 300 s and 3 attempts. Pick one expiry
   (600 s) and hashed storage (`storeOTP: "hashed"`, matching
   `storeToken: "hashed"`, `features/account/backend/auth/auth-options.ts:24-31`).
   Add rate-limit rules for `/email-otp/*` beside the magic-link rule.
4. **Sign-up through OTP.** `emailOTP` `disableSignUp` defaults to `false`,
   which matches magic link's account creation. Check that the user-creation
   hooks and `locale` metadata run the same way on the OTP path
   (`signIn.emailOtp` has no `metadata`; locale may need another source).
5. **Success navigation.** A code sign-in sets the cookie in the code tab
   itself, so it should navigate the same way `navigateToAccount` does
   (`window.location.replace(getAccountPath(locale))`). Reuse that helper and
   call `authReturn.cancel()` first, so a late link-tab hand-off can't trigger
   a second navigation.
6. **No other single-method assumptions** were found: no `returnTo`, no
   `errorCallbackURL`/`newUserCallbackURL`, and the callback page treats any
   session as success.

## Recommended approach

- Keep `/[locale]/auth/sign-in`. Behind `login_email_code`, replace the
  `requested` "Check your inbox" card in `SignInCard` with a code form; keep
  using `authReturn.sendMagicLink` (now with a code in the email).
- Same-profile auto-continue comes from the existing lifecycle unchanged.
  Optionally add a focus/visibility session check for reloads.
- Persist `{ email, requestedAt }` in `sessionStorage`, never in the URL.
  Restore after hydration and expire after 10 minutes.
- Add shadcn `input-otp` with six digit slots and `autoComplete="one-time-code"`.
- Tests: extend `sign-in-card.test.tsx` (code step, restore from
  `sessionStorage`, cancel on code success) and `auth-return.browser.test.ts`
  (the hand-off still reaches a code-step card). E2E: one code-typing path plus
  the existing link path.

## Uncertainties

- `window.close()` on a tab opened from a mail client works only when the
  browser treats it as script-closable. The fallback navigation already covers
  this case.
- I didn't verify that `input-otp` defaults survive the current shadcn
  generator; check after adding.
- Whether `signIn.emailOtp` runs the same user-creation and `locale` hooks as
  magic link needs a source check in `auth-server.ts` during implementation.
