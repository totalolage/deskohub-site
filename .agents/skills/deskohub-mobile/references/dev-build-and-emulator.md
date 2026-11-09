# Development build and emulator

A development build (dev client) is a debug APK with `expo-dev-client` that
loads its JavaScript from Metro, so a JavaScript change needs only a reload.
Build a new one after a change to native code, a config plugin, a native
dependency, `app.json` or `app.config.ts`. Paths are relative to
`apps/deskohub-mobile`.

## Prerequisites

Android SDK with `ANDROID_HOME` (and `ANDROID_SDK_ROOT`) set, JDK 17, NDK
27.1.12297006, Node 22 or later, and dependencies installed with `bun install`
at the repository root. A clean Gradle build of the app takes about four
minutes and peaked near 13 GB of memory with the four-worker cap below; lower
`--max-workers` on a machine with less to spare.

## Choose the backend

The native app reads `EXPO_PUBLIC_API_ORIGIN` for both the customer API and the
updates URL and defaults to production, with a real customer account. Plain
HTTP is accepted only for `localhost`, `127.0.0.1` and the emulator's host
alias `10.0.2.2`.

- Local Workspace: `EXPO_PUBLIC_API_ORIGIN=http://localhost:3000` plus
  `adb reverse tcp:3000 tcp:3000`. Better Auth trusts only `localhost:3000` in
  development, so keep that port rather than `10.0.2.2`. Native email sign-in
  opens the web bundle's `/app/sign-in`, which the Workspace dev server serves
  only after the export is built into it
  ([web app](web-app-and-android-page.md#app-web-app)). This is the simplest
  backend for a dev client.
- A preview: deployment protection refuses requests without the bypass, and
  the app never sends it, so the emulator reaches a preview only through a
  forwarding proxy on the host at `http://localhost:<port>` (plus
  `adb reverse tcp:<port> tcp:<port>`), which keeps the bypass value off the
  device. The repository ships no such proxy. It must add
  `x-vercel-protection-bypass`, rewrite `Host`, `Origin` and `Referer` to the
  preview and `Location` back to itself, and map the session cookie between
  the preview's `__Secure-` name and the plain name an HTTP origin can hold,
  because preview auth trusts only its own HTTPS host. A dev client allows
  plain HTTP. A release-shaped build doesn't: build it from a temporary
  evidence commit that adds `"usesCleartextTraffic": true` to the
  `expo-build-properties` `android` options in `app.json`, with
  `EXPO_PUBLIC_API_ORIGIN` set to the proxy origin, and never push that
  commit. Sign in with a synthetic recipient and read its magic link from the
  preview's runtime logs (`deskohub-workspace-account` skill,
  `references/magic-link-delivery-and-e2e.md`); open it in the emulator's
  Chrome at the proxy origin, the browser that holds the pending handoff,
  then choose "Open in app".
- Production: only for read-only checks with an account you own, never for
  booking or profile changes.

`EXPO_PUBLIC_API_ORIGIN` is read when Metro bundles, and an `https` preview
origin also adds an unverified App Link filter for that host at prebuild. Set
it for both steps to the same value.

## Build the dev client

From `apps/deskohub-mobile`, with `MOBILE_UPDATES_CODE_SIGNING` unset:

```bash
CI=1 bunx expo prebuild --platform android --no-install --clean
(cd android && ./gradlew assembleDebug --no-daemon --max-workers=4 -PreactNativeArchitectures=x86_64)
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk` (about
125 MB). `x86_64` matches the emulator; drop the flag for an ARM device.
`--no-daemon` matters on a shared machine: a Gradle daemon killed mid-build
fails it with "Gradle build daemon disappeared". `android/` is generated and
git-ignored; `--clean` regenerates it from the config. The build also writes
`modules/trusted-web-activity/android/build/`, which the app's `.gitignore`
covers (`/modules/*/android/build/`).

`bunx eas-cli@27.5.0 build --platform android --profile development --local`
builds the same kind of APK through EAS. It needs an Expo login
(`EXPO_TOKEN`) and a temporary directory with room for a full Android build;
the prebuild route needs neither.

If the dev client shows "Must specify --private-key-path argument to sign
development manifest", it was built with `MOBILE_UPDATES_CODE_SIGNING`
set; rebuild without it (`deskohub-mobile-release` skill, update code signing).

## Run it on the emulator

The T3 device panel drives the Android Virtual Device `T3_API_35` (API 35,
Google APIs, x86_64, KVM). Open the device through the panel's device tools,
and drive the app with the `agent-device` command the open call returns
(launch, taps, text, deep links, screenshots). One emulator serves every
session on the machine: never close or wipe a device another session is
using.

1. Install the APK: `adb install -r android/app/build/outputs/apk/debug/app-debug.apk`.
   A release-signed APK with the same id must be uninstalled first
   (`adb uninstall cz.deskohub.workspace`), which drops its sign-in.
2. Start Metro from the repository root, with the same
   `EXPO_PUBLIC_API_ORIGIN` as the build:
   `bun turbo dev --filter=deskohub-mobile`, or `bun run dev` from the app
   directory. The `dev` script compiles Paraglide once, then runs `expo start`
   on port 8081 and recompiles messages on change.
3. Forward Metro into the emulator: `adb reverse tcp:8081 tcp:8081`, plus the
   backend port when it is local. Reverse rules end when the emulator
   restarts.
4. Launch the dev client and pick the Metro server, or open
   `exp+deskohub-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`
   as a deep link.
5. When done, remove your reverse rules (`adb reverse --remove tcp:<port>`)
   and stop Metro.

The runtime check is the smoke screen `/dev/effect-smoke`: an Account tab row
in a dev build, or the deep link `deskohub://dev/effect-smoke`. It runs the
Effect, shared-package, Paraglide and `Intl` cases on the device's Hermes and
reports passed and failed counts; every case passes on a healthy build, with
the designed fallbacks for `Intl.DisplayNames` and exact decimals. Run it after
upgrading Expo, Effect or a shared package. `adb` stays useful for what
the panel lacks: `logcat`, `am force-stop`, and
`cmd locale set-app-locales cz.deskohub.workspace --locales cs-CZ` to switch
the app language.

## What the emulator can't show

- Update signing and the update check need a release-shaped build
  (`deskohub-mobile-release` skill, local build with `--signing debug`). Against
  production it shows the signed "no update" answer and no banner. The OTA
  "update ready" banner needs a published update, which only a tagged release
  makes (`references/ota-updates.md` in that skill).
- Verified App Link opening, native passkeys and a live Obtainium badge need
  the tagged, release-signed APK: `assetlinks.json` lists only the release
  certificate, so any locally signed build fails verification
  ([auth and passkeys](auth-and-passkeys.md)), and Obtainium needs a published
  release. The Trusted Web Activity falls back to a Custom Tab with a visible
  toolbar when verification fails, which is expected on a local build.
- Passkey creation: the emulator has no platform authenticator, so only the
  screens can be checked.
- The link-only "sent" state needs the `login_email_code` flag off; previews
  run with it on.

The release skill's physical-device checklist collects these for the first
tagged release.
