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
minutes and several GB of memory; on a shared machine keep the worker cap
below.

## Choose the backend

The native app reads `EXPO_PUBLIC_API_ORIGIN` for both the customer API and the
updates URL and defaults to production, with a real customer account. Plain
HTTP is accepted only for `localhost`, `127.0.0.1` and the emulator's host
alias `10.0.2.2`.

- Local Workspace (`bun run dev` in `apps/deskohub-workspace`):
  `EXPO_PUBLIC_API_ORIGIN=http://localhost:3000` plus
  `adb reverse tcp:3000 tcp:3000`. Better Auth trusts only `localhost:3000` in
  development, so keep that port rather than `10.0.2.2`.
- A preview: Vercel deployment protection answers every request without the
  bypass, and the app never sends it. Run a local forwarding proxy that adds
  the `x-vercel-protection-bypass` header to each request and rewrites nothing
  else, set `EXPO_PUBLIC_API_ORIGIN=http://localhost:<proxy port>`, and
  `adb reverse` that port. Preview data is synthetic: sign in with a
  synthetic recipient and read its magic link from the preview's runtime
  logs (`deskohub-workspace-account` skill,
  `references/magic-link-delivery-and-e2e.md`). The link names the preview
  host, which the app doesn't claim: open it in the emulator's Chrome with the
  host replaced by the proxy origin, then choose "Open in app" so the session
  handoff reaches the app.
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
git-ignored; `--clean` regenerates it from the config.

`bunx eas-cli@27.5.0 build --platform android --profile development --local`
builds the same kind of APK through EAS. It needs an Expo login
(`EXPO_TOKEN`) and a temporary directory with room for a full Android build;
the prebuild route needs neither.

If the dev client shows "Must specify --private-key-path argument to sign
development manifest", it was built with `MOBILE_UPDATES_CODE_SIGNING`
set; rebuild without it ([release](release.md#update-code-signing-and-development-clients)).

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
   `bun turbo dev --filter=deskohub-mobile`. The Turbo task compiles Paraglide
   first, then runs `expo start` on port 8081 and recompiles messages on change.
   Running `bun run dev` in the app directory skips that first compile.
3. Forward Metro into the emulator: `adb reverse tcp:8081 tcp:8081`, plus the
   backend port when it is local. Reverse rules end when the emulator
   restarts.
4. Launch the dev client and pick the Metro server, or open
   `exp+deskohub-mobile://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081`
   as a deep link.
5. When done, remove your reverse rules (`adb reverse --remove tcp:<port>`)
   and stop Metro.

In a dev build the Account tab has a row for `/dev/effect-smoke`, which runs
the Effect, Paraglide and `Intl` smoke cases on the device's Hermes. Run it
after upgrading Expo, Effect or a shared package. `adb` stays useful for what
the panel lacks: `logcat`, `am force-stop`, and
`cmd locale set-app-locales cz.deskohub.workspace --locales cs-CZ` to switch
the app language.

## What a dev client can't show

- Update signing, OTA delivery and the update banner need a release-shaped
  build ([release](release.md#local-build) with `--signing debug`) pointed at
  the server under test ([OTA updates](ota-updates.md)). A release-shaped
  build blocks plain HTTP, so it can't use a `localhost` origin as is.
- Native passkeys and verified App Links trust only the release signing key on
  production, so they need the release APK on production, on a physical
  device ([auth and passkeys](auth-and-passkeys.md)). The Trusted Web Activity
  falls back to a Custom Tab with a visible toolbar when verification fails,
  which is expected on a debug build.
