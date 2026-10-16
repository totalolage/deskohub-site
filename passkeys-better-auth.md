# Passkey (WebAuthn) customer sign-in on Better Auth — research findings

Checked 2026-10-16 against the repo at `/home/dev/.t3/worktrees/deskohub/t3-7aea9b43` (`apps/deskohub-workspace` pins `better-auth` 1.7.2, `@better-auth/drizzle-adapter` 1.7.2, `@playwright/test` 1.61.1).

Notation: `PK:` = `/home/dev/scratch/passkeys/pkg/drone-a-passkey-1.7.2/unpacked/package/` (the `@better-auth/passkey@1.7.2` tarball, packed with scripts disabled). `BA:` = `/home/dev/.bun/install/cache/better-auth@1.7.2@@@1/`. `APP:` = `apps/deskohub-workspace/`. The worktree has no `node_modules`, so the local Bun cache and the packed tarball stand in for installed sources. **[Inference]** marks deductions that no single source states.

Detailed evidence packets, with more citations:
- `drone-a-local-map.md`: installed sources and repo auth config
- `drone-b-web-better-auth.md`: Better Auth docs, issues, advisories and versions
- `drone-c-web-webauthn.md`: WebAuthn spec, RP ID rules, Playwright testing, UX guidance

---

## 1. Plugin package, deps, schema, options, endpoints, client

**Package.** The plugin ships separately as `@better-auth/passkey`, with server entry `@better-auth/passkey` and client entry `@better-auth/passkey/client` (`PK:package.json:2-3,29,35`). Better Auth 1.7.2 does not export `better-auth/plugins/passkey`: `BA:dist/plugins/index.mjs:49` exports magicLink and emailOTP but no passkey, and the `BA:package.json` exports map has no passkey subpath. The plugin moved out of core in 1.4 (https://github.com/better-auth/better-auth/blob/main/docs/content/blogs/1-4.mdx). `@better-auth/passkey` is not in `APP:package.json` yet. Sibling worktrees hold 1.6.23 copies; none is 1.7.2.

**Dependencies.** Runtime: `@simplewebauthn/browser ^13.3.0`, `@simplewebauthn/server ^13.3.1`, `zod ^4.3.6` (`PK:package.json:51-54`). Peers: `better-auth ^1.7.2`, `@better-auth/core ^1.7.2`, `@better-auth/utils 0.4.2`, `@better-fetch/fetch 1.3.1`, `better-call 1.4.0`, `nanostores ^1.0.1` (`PK:package.json:62-68`). Pin `@better-auth/passkey` to the same version as `better-auth`.

**Schema** (`PK:dist/index-B7Y0IgKK.d.mts:14-56`, `PK:dist/index.mjs:669-700`): table `passkey` with columns `id`, `name?` string, `publicKey` string, `userId` string (FK to user.id, indexed), `credentialID` string (indexed), `counter` number, `deviceType` string, `backedUp` boolean, `transports?` string (stored comma-joined, `PK:dist/index.mjs:396`), `createdAt?` date, `aaguid?` string. The repo's auth schema is hand-maintained Drizzle under `pgSchema("auth")`, with an explicit adapter table map (`APP:db/schema/auth.ts:19,148-153`) and migrations from `drizzle-kit generate` (`APP:package.json:16`). The passkey table has to be added to `db/schema/auth.ts` and to that map by hand. **[Inference]** `npx auth migrate` is not this repo's flow.

**Server options** (`PK:dist/index-B7Y0IgKK.d.mts:86-190`):
- `rpID?: string`, a static string with no per-request function (`:147`).
- `rpName?: string`. The runtime falls back to `ctx.context.appName` (`PK:dist/index.mjs:167`).
- `origin?: string | string[] | null` (`:162`). An array is accepted, added in PR https://github.com/better-auth/better-auth/pull/4800. When null, the expected origin is the request `Origin` header (`PK:dist/index.mjs:337-338`).
- `authenticatorSelection?` (`:167`). The defaults are `residentKey: "preferred"` and `userVerification: "preferred"`, with attestation `none` (`PK:dist/index.mjs:172-180`).
- `advanced.webAuthnChallengeCookie?` (`:177`), default `better-auth-passkey`. The challenge lives 300 s (`PK:dist/index.mjs:776,782`).
- `schema?` overrides (`:182`).
- `registration.{requireSession (default true), resolveUser, afterVerification, extensions}` (`:86-124`).
- `authentication.afterVerification` (`:126-134`).
- Both verify endpoints pass `requireUserVerification: false` to SimpleWebAuthn (`PK:dist/index.mjs:355`, `:483`).

**Endpoints** (base `/api/auth`, mounted at `APP:app/api/auth/[...all]/route.ts:15`):

| Path | Method | Gate |
|---|---|---|
| `/passkey/generate-register-options` | GET | `freshSessionMiddleware` unless `registration.requireSession: false` (`PK:dist/index.mjs:86-88`) |
| `/passkey/verify-registration` | POST | same (`PK:dist/index.mjs:321-324`) |
| `/passkey/generate-authenticate-options` | GET | none; it reads an optional session to narrow `allowCredentials` (`:209-265`) |
| `/passkey/verify-authentication` | POST | none; it creates a session (`:432-508`) |
| `/passkey/list-user-passkeys` | GET | `sessionMiddleware` (`:533-535`) |
| `/passkey/delete-passkey` | POST | session plus ownership check (`:581-584`) |
| `/passkey/update-passkey` | POST | session plus ownership check (`:630-636`) |

**Client** (`passkeyClient`, `PK:dist/client.mjs`, `PK:dist/client.d.mts`):
- `signIn.passkey({ autoFill?, extensions?, returnWebAuthnResponse?, fetchOptions? })` (`client.d.mts:28-33`). `autoFill` maps to SimpleWebAuthn `startAuthentication({ useBrowserAutofill })` (`client.mjs:19-24`).
- `passkey.addPasskey({ name?, authenticatorAttachment?, ... })` (`client.mjs:161-166`).
- `passkey.listUserPasskeys`, `passkey.deletePasskey({ id })` and `passkey.updatePasskey({ id, name })` are inferred from the server endpoints (`PK:dist/index.mjs:529,577,626`).
- The nanostore atom is named `listPasskeys` (`client.mjs:183-185`). There is no `useListPasskeys` symbol.

**Conditional UI.** Per the docs (https://better-auth.com/docs/plugins/passkey), the input carries `autocomplete="username webauthn"`. Check `PublicKeyCredential.isConditionalMediationAvailable()`, then call `signIn.passkey({ autoFill: true })` on mount. The repo's email field is `type="email" autoComplete="email"` (`APP:features/account/components/sign-in-card.tsx:255-257`). **[Inference]** It would need `autoComplete="email webauthn"` (or `username webauthn`). Per web.dev, `webauthn` must be the last token (https://web.dev/articles/passkey-form-autofill).

## 2. Passkey as the first credential, and session freshness

- **Registration requires a fresh session by default.** Both registration endpoints use `freshSessionMiddleware` when `requireSession` is true, which is the default (`PK:dist/index.mjs:86-88,321-324`). The repo sets `session.freshAge = 10 min` (`APP:features/account/backend/auth/auth-options.ts:13`). Since Better Auth 1.6, freshness is measured from session **creation** (https://github.com/better-auth/better-auth/blob/main/docs/content/blogs/1-6.mdx). **[Inference]** An "Add passkey" button in account settings fails with a stale-session error once the session is more than 10 minutes old, so it needs the same re-auth hop the delete-account flow already uses. A prompt shown right after sign-in falls inside the fresh window.
- **Passkey-first sign-up has been possible since passkey 1.6.0** ("pre-auth registration flow", https://github.com/better-auth/better-auth/blob/main/packages/passkey/CHANGELOG.md). Set `registration.requireSession: false` and supply `registration.resolveUser(ctx, context)`, which must return `{ id, name }` for the account being registered (`PK:dist/index.mjs:23-48`). The verify step rejects the request when a session exists and `userData.id` differs from the session user (`PK:dist/index.mjs:347-348`). **[Inference]** The app would own proof that the user controls the identity (for example, a verified email first). Turning off `requireSession` also drops the fresh-session gate for signed-in users, so `resolveUser` must enforce any freshness policy itself. Without that gate, a stolen old session could add an attacker's passkey. This makes passkey-only sign-up a riskier option than "add after email sign-in".

## 3. RP ID constraints

- **Spec.** The RP ID must equal the origin's effective domain or a registrable suffix of it. It cannot be a public suffix, and each credential is scoped to the RP ID it was registered under. `http://localhost` counts as a secure origin (https://www.w3.org/TR/2026/REC-webauthn-3-20260825/#sctn-rp-id).
- **`vercel.app` is on the Public Suffix List** (https://publicsuffix.org/list/public_suffix_list.dat). **[Inference]** Every `*.vercel.app` preview host is its own site and cannot share the production RP ID. Production passkeys will never work on previews, and preview passkeys are bound to one exact preview host.
- **The repo's dynamic baseURL breaks the default rpID.** Workspace uses `baseURL: { allowedHosts: [...] }` (`APP:features/account/backend/auth/auth-server.ts:642`), built from the brand domain plus the Vercel production, deployment and branch URLs (`APP:features/account/server/auth.server.ts:28-33`). The plugin's `getRpID` only reads a **string** baseURL and otherwise falls back to `"localhost"` (`PK:dist/index.mjs:13-14,354,476`). **Confirmed:** with no explicit `rpID`, every non-localhost ceremony would fail RP ID verification, so `rpID` must be set explicitly. Because it is a static string, a single auth instance can serve only one RP ID. **[Inference]** A preview deployment reachable at both its deployment URL and its branch URL can support passkeys on only one of the two. The rpID could be chosen per deployment at instance construction (for example, the branch host from env), with `origin` set to the matching origin(s).
- **No per-request rpID upstream.** Per-request rpID is open issue https://github.com/better-auth/better-auth/issues/11421, with open PR https://github.com/better-auth/better-auth/pull/11594 against main. It is not in 1.7.10.
- **Related Origin Requests** (`https://{rpId}/.well-known/webauthn`, §5.11, https://www.w3.org/TR/2026/REC-webauthn-3-20260825/#sctn-related-origins): the list takes exact origins only, with no wildcards. Chrome caps it at 5 eTLD+1 labels (https://web.dev/articles/webauthn-related-origin-requests). Browser support: Chrome 128+, Safari 18+, Firefox 152+ (https://passkeys.dev/device-support/, https://webkit.org/blog/15865/webkit-features-in-safari-18-0/, https://bugzilla.mozilla.org/show_bug.cgi?id=2010193). **[Inference]** ROR suits a few extra prod brand domains. It does not suit ephemeral previews: each `x.vercel.app` uses up one label, and previews hit a separate preview database anyway.

## 4. Issues, advisories, version

- Latest is `better-auth` / `@better-auth/passkey` 1.7.10, with 1.8.0-beta.1 on beta (https://registry.npmjs.org/better-auth/latest). The passkey changelog for 1.7.3–1.7.10 records only a dependency bump in 1.7.8. Fixes that 1.7.2 already includes: 1.6.10 handles autofill cancellation and `NotSupportedError` (https://github.com/better-auth/better-auth/issues/9373, https://github.com/better-auth/better-auth/pull/9429), and 1.6.17 fixes challenge matching.
- Passkey IDOR GHSA-4vcf-q4xf-f48m affected `<1.4.0` only, so 1.7.2 is clear (https://github.com/better-auth/better-auth/security/advisories/GHSA-4vcf-q4xf-f48m).
- Core GHSA-965c-763c-88jm (critical, `<1.7.7`) lets an OAuth state be used as a magic link. It requires at least one social or Generic OAuth provider (https://github.com/better-auth/better-auth/security/advisories/GHSA-965c-763c-88jm, checked directly). A grep of `APP` for `socialProviders|genericOAuth|oAuthProxy` found nothing, so the repo is **not affected in its current config**. GHSA-r4xp-prcw-77qf (OAuth Proxy, `<1.7.7`) does not apply either.
- **Conclusion:** no upgrade is strictly required for passkeys. Installing `@better-auth/passkey@1.7.2` matches the peers. Upgrading both to ≥1.7.7 is cheap hygiene and closes the advisories in case OAuth is ever added. **[Inference]**
- Open SPA conditional-UI cancellation issue https://github.com/better-auth/better-auth/issues/9286 was closed as not planned. **[Inference]** Unmounting the sign-in form leaves a pending conditional request, which the next `startAuthentication` aborts in SimpleWebAuthn.

## 5. Testing

- The repo runs Chromium only, in every Playwright config (`APP:shared/testing/playwright-browser.ts:4-12`), on `@playwright/test` 1.61.1.
- **Playwright 1.61** added `browserContext.credentials` (`install`, `create(rpId)`, `get`, `delete`), a virtual authenticator that overrides `navigator.credentials.create/get` (https://playwright.dev/docs/api/class-credentials, "Added in: v1.61", checked directly). The release notes say it works in all browsers (https://playwright.dev/docs/release-notes#version-161). It is available at the repo's pinned version.
- **Chromium CDP:** `page.context().newCDPSession(page)`, then `WebAuthn.enable`, then `WebAuthn.addVirtualAuthenticator({ protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true })` (https://chromedevtools.github.io/devtools-protocol/tot/WebAuthn/). This path exercises the browser's real WebAuthn stack, origin and RP ID checks included, so it is the stronger test.
- **Conditional UI:** no primary source confirms that headless Chrome with a virtual authenticator renders the native autofill picker. **[Inference]** E2E can assert that the conditional request is started and resolves. The native picker needs manual or headed verification.
- Firefox and WebKit: covered only through the Playwright `credentials` interception API, not the native stacks. WebDriver BiDi WebAuthn is still under discussion (https://github.com/w3c/webauthn/issues/2072).

## 6. UX guidance

- **Where to offer creation.** Google says during sign-in, in security settings, after account recovery and after reauthentication (https://developers.google.com/identity/passkeys/ux/user-journeys). FIDO's research (26 US participants) found prompts during sign-in performed worse than prompts tied to account tasks (https://fidoalliance.org/wp-content/uploads/2023/05/FIDO-Alliance-UX-Guidelines-for-Passkey-Creation-and-Sign-ins.pdf). The two sources conflict.
- **Automatic upgrade.** Conditional create (`mediation: 'conditional'` on `create`) runs after a successful non-passkey sign-in. Support: Chrome 136 desktop and 142 Android, Safari 18; not Firefox (https://developer.chrome.com/blog/new-in-chrome-136, https://passkeys.dev/device-support/). Feature-detect it with `getClientCapabilities().conditionalCreate`. **[Inference]** better-auth 1.7.2's `addPasskey` does not expose `mediation: 'conditional'`; that was not checked further.
- **Naming and management.** Name each passkey from its AAGUID via the community passkey-authenticator-aaguids list, falling back to the user agent (https://developers.google.com/identity/passkeys/developer-guides/server-registration, https://github.com/passkeydeveloper/passkey-authenticator-aaguids). Show one card per passkey with provider, created and last-used times, rename and delete (https://developers.google.com/identity/passkeys/ux/user-interface-design). The schema has `aaguid` and `createdAt` but **no last-used column**.
- **Recovery.** Keep the email fallback, including after a user deletes every passkey (https://developers.google.com/identity/passkeys/ux/communicating-passkeys).
- **Signal API** (`signalUnknownCredential`, `signalAllAcceptedCredentials`, `signalCurrentUserDetails`): Chrome 132 and Safari 26, not Firefox (https://developer.chrome.com/docs/identity/webauthn-signal-api, MDN). Safari has a hang bug (https://bugs.webkit.org/show_bug.cgi?id=324909). Useful after a passkey is deleted on the server.

## 7. Re-authentication for sensitive actions

- **Current repo flow.** Delete-account calls Better Auth delete-user and maps SESSION_EXPIRED to "reauth required" (`APP:features/account/backend/auth/delete-account-endpoint.ts:24-32`). Re-auth sends a magic link or code, which creates a new session (`APP:features/account/components/delete-account-reauth-step.tsx:28-51`, `APP:features/account/auth-return.ts:330-338`).
- **Passkey re-auth.** `verify-authentication` always creates a new session and sets its cookie (`PK:dist/index.mjs:500-508`). **[Inference]** A passkey sign-in therefore yields a fresh session under the created-at rule, so it can stand in for the email re-auth step. The app should check that the asserted user matches the current user, either by limiting `allowCredentials` to that user's credentials or by comparing the returned user ID. Otherwise a different account's passkey replaces the session. `generate-authenticate-options` already narrows `allowCredentials` when a session is present (`PK:dist/index.mjs:209-265`), and passkeys.dev recommends exactly that (https://passkeys.dev/docs/use-cases/reauth/). The old session is not revoked.
- No step-up "verify passkey without a new session" API exists in stable releases. It was requested in https://github.com/better-auth/better-auth/issues/8071; PR https://github.com/better-auth/better-auth/pull/9620 (`verifyPasskey`) is open against `next`.
- **[Inference]** Because server verification sets `requireUserVerification: false`, a passkey re-auth proves possession but not necessarily user verification. Requiring UV would mean `authenticatorSelection.userVerification: 'required'` plus a check in `authentication.afterVerification`; the plugin offers no server-side UV flag.
