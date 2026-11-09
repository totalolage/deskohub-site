# Auth and passkeys

The app signs in against the Workspace's Better Auth. Server behavior (the
`native-sign-in` plugin, the magic-link App Link, the PKCE session handoff,
`ACCOUNT_SWITCH_REFUSED`) is in the `deskohub-workspace-account` skill,
`references/better-auth-configuration.md` (Security settings, "Native app
sign-in"); customer API session and origin checks are in its
`references/customer-http-api.md`. This page covers the app side and the
origins. App paths are relative to `apps/deskohub-mobile/src/auth`.

## Client

- Native: `auth-client.native.ts` builds the Better Auth client at
  `<API origin>/api/auth` with `@better-auth/expo`'s `expoClient` (scheme
  `deskohub`, storage prefix `deskohub`) over Expo SecureStore. It sends the
  `expo-origin` header, which the server trusts as `deskohub://`; native
  requests carry no `Origin`. The customer API transport reads the same
  SecureStore cookie.
- Keep `expo-network` installed. `@better-auth/expo` imports this optional peer
  when a client's session atom first mounts, which every `/get-session` read
  does. Metro fails a missing module synchronously, past the plugin's catch,
  so without it every sign-in client's session read failed and every
  reauthentication ended as "unavailable" (#1123). Bun rejects the import
  instead, so `native-auth-client.test.ts` pins the dependency.
- Web (the `/app/` bundle): `auth-client.web.ts` uses the site's cookies on the
  same origin and `passkeyClient()`.
- Every write to the stored session (sign-in, sign-out, passkey sign-in, web
  verification) runs under `withSessionWriteLock` (`session-write-lock.ts`), so
  concurrent flows can't interleave. A `/get-session` response already in flight can still race a
  sign-out.
- `x-deskohub-locale` on the sign-in code and magic-link verify requests names
  the app locale and seeds a new account's language
  (`sign-in-locale.ts`).

## Native email sign-in

The app never sends the magic-link or code request itself, so BotID stays a
browser check. `native-sign-in.ts` persists a PKCE verifier and state, then
opens the web bundle's `/app/sign-in?native=1` in an in-app auth session:

- Android prefers a Trusted Web Activity (`modules/trusted-web-activity`);
  otherwise `auth-session-browser.service.ts` opens a Custom Tab in a named
  browser package, because the app claims the HTTPS `/app/` App Link and
  Android would otherwise hand the URL back to the app. The Custom Tab uses
  `createTask: false`: in its own task, Android can restore a stale page with
  old PKCE state on retry.
- The customer finishes sign-in in that browser session; the page mints a
  handoff code, returns to `deskohub://auth/callback` or the `/app/auth/callback`
  App Link with code and state, and `auth-callback.ts` exchanges it with the
  verifier.
- A magic link opened later on the device arrives as the
  `/app/auth/callback?token=…` App Link; the app verifies the token itself with
  its Expo origin. `ACCOUNT_SWITCH_REFUSED` keeps the current account signed in
  and the link unused.
- The TWA needs the site's `assetlinks.json` and the app's `asset_statements`
  to agree on the signing key. On a debug-signed build, or on first launch
  before verification finishes, it falls back to a Custom Tab with a visible
  toolbar.

## Passkeys

Native ceremonies use `react-native-passkeys` (no config plugin); the web
bundle uses Better Auth's `passkeyClient()`. Both sit behind the
`passkey-ceremonies-layer` platform pair in `passkey/`;
`one-ceremony-at-a-time.ts` keeps native ceremonies from overlapping, and screens use
`use-passkey-ceremony.ts`.

The Workspace resolves the relying party per environment
(`apps/deskohub-workspace/features/account/backend/auth/auth-hosts.ts`):

| Environment | RP ID | Origins |
| --- | --- | --- |
| Production | the customer-facing host, fixed forever (changing it orphans every passkey) | `https://` that host and `android:apk-key-hash:<release key>` |
| Preview | the immutable deployment host | its `https://` origin only |
| Development | `localhost` | `http://localhost:3000`, plus the debug key's `android:apk-key-hash` when `ANDROID_DEBUG_SIGNING_CERT_SHA256` is set |

The release key's hash comes from `nativeApp.androidReleaseCertificate`
(`apps/deskohub-workspace/features/account/backend/auth/native-app.ts`), equal
to `releaseCertificateSha256` in `apps/deskohub-mobile/scripts/release/apk-signature.ts`.
Android Credential Manager also checks `get_login_creds` in the RP host's
`assetlinks.json`, so native passkeys work only with the release APK against
production. Test them on a physical device with a credential provider; whether
an emulator's provider completes the ceremony is unverified. Preview and
emulator checks cover the web bundle's passkeys and the native code paths up
to the ceremony.

## Association files

- `/.well-known/assetlinks.json` grants `get_login_creds` and
  `handle_all_urls` to `cz.deskohub.workspace` with the release fingerprint
  (`apps/deskohub-workspace/features/account/backend/auth/native-app-association.ts`).
  Production's App Link for
  `https://workspace.deskohub.cz/app/` is `autoVerify`; a build aimed at a
  preview adds an unverified filter for that host, which a tester approves in
  the app's Android settings.
- `/.well-known/apple-app-site-association` (`webcredentials` and `applinks`
  for `/app/*`) needs `APPLE_TEAM_ID` and answers 404 without it. There is no
  Apple account yet, so iOS passkeys and universal links stay unconfigured.
- A third-party app can register `deskohub://` too. Keep secrets out of scheme
  callbacks: a handoff code is useless without the verifier only the app
  holds.
