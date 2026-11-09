---
name: deskohub-mobile
description: Mobile app, apps/deskohub-mobile, Expo, Expo Router, React Native, Hermes, mobile import ban, development build, dev client, Android emulator, T3 device panel, T3_API_35, adb reverse, Metro, EXPO_PUBLIC_API_ORIGIN, expo prebuild, Gradle, eas build --local, Android APK, mobile-v tag, mobile release, versionCode, mobile CHANGELOG, release keystore, apksigner, Sculpin font licence, OTA update, expo-updates, update server, rollback, fingerprint runtime version, MOBILE_UPDATES_CODE_SIGNING, private-key-path, update banner, /app/ PWA, web export, /android page, Obtainium, latest Android release, native sign-in, App Link, Trusted Web Activity, Custom Tabs, native passkeys, apk-key-hash, assetlinks, apple-app-site-association, app analytics, posthog-react-native.
---

# Deskohub mobile app

`apps/deskohub-mobile` is one Expo SDK 58 and Expo Router codebase: the
sideloaded Android APK (scheme `deskohub`, id `cz.deskohub.workspace`), an iOS
build that ships nowhere yet, and the web export the Workspace serves at
`/app/` as the installable PWA. It covers the customer account and the native
booking flows, not the presentation pages. Paths are relative to
`apps/deskohub-mobile` unless they start with `apps/` or `packages/`.

## Always-apply rules

- Reach the backend only through the customer HTTP API and Better Auth's
  endpoints. Customer operations are Workspace services behind the
  `/api/customer` adapter; add an endpoint there, never logic in the app
  (`deskohub-workspace-account` skill, `references/customer-http-api.md`).
- The app shares only portable packages. Biome bans `next`, `next/**`,
  `@deskohub/next-effect` and the `next`, `action` and `request-locale`
  entries of `@deskohub/i18n` inside the app; see
  [package layout](references/package-layout.md).
- Expo continuous native generation owns `android/` and `ios/`: change native
  config through `app.json`, `app.config.ts`, a config plugin in `plugins/`, or
  a local module in `modules/`, never by committing generated folders.
- A change to native code, config plugins, native dependencies or anything
  else in the fingerprint ships as a new APK. OTA updates carry JavaScript and
  assets to installed apps with the same runtime version only.
- Keep development clients unsigned for updates: leave
  `MOBILE_UPDATES_CODE_SIGNING` unset for them. Only release and OTA builds set
  it to exactly `required`.
- A native build without `EXPO_PUBLIC_API_ORIGIN` talks to production. Point
  development and test builds at a preview or a local Workspace on purpose.
- The UI mirrors the site brand through `@deskohub/brand-tokens`; never reuse
  site React components.

## References

Read the reference that matches the change before editing:

- [Package layout and checks](references/package-layout.md): routes and
  `src/` features, local modules and config plugins, shared-package rules and
  the import ban, Hermes limits, tests, lint, typecheck and Mobile CI.
- [Development build and emulator](references/dev-build-and-emulator.md):
  building a debug dev client, the T3 device panel and AVD, Metro and
  `adb reverse`, choosing the backend origin, and what only a release build or
  a physical device can show.
- [Release](references/release.md): `expo.version`, the CHANGELOG and the
  `mobile-v` tag, the release workflow and PR dry runs, local
  `eas build --local`, release and update signing, and the latest-release
  endpoint.
- [OTA updates](references/ota-updates.md): the self-hosted Expo Updates
  server, publishing, rollback, runtime-version matching, and the in-app update
  banner.
- [Auth and passkeys](references/auth-and-passkeys.md): the app's Better Auth
  client, native email sign-in through the web bundle, the session handoff,
  passkey origins per environment, and the association files.
- [Web app and Android download](references/web-app-and-android-page.md): the
  `/app/` export and its hosting, the PWA shell, the `/android` page,
  Obtainium, and open-in-app detection.
- [Analytics](references/analytics.md): PostHog React Native, consent on
  native and web, typed events, identity and feature flags.
