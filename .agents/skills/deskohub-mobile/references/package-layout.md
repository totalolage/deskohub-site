# Package layout and checks

Paths are relative to `apps/deskohub-mobile`.

## Layout

- `app/` holds the Expo Router routes. `app/_layout.tsx` gates the signed-in
  routes and mounts analytics, locale, customer-data cleanup and the update
  banner. `app/(account)/(tabs)` holds the Reservations and Account tabs;
  booking routes stack outside the tab bar. `app/dev/effect-smoke.tsx` is a
  development-only screen (an Account tab row when `__DEV__`) that runs the
  `src/smoke` cases (Effect, Paraglide, `Intl`) on the device's Hermes.
- `app/+native-intent.ts` maps an incoming `https://<host>/app/<route>` App
  Link to its route: native ignores the web `baseUrl` (`/app`), so every App
  Link needs this mapping. `index.ts` sanitizes incoming auth URLs before the
  router sees them.
- `src/` is split by feature: `account/`, `auth/`, `booking/`, `analytics/`,
  `consent/`, `customer-api/`, `i18n/`, `routing/`, `updates/`, `platform/`,
  shared `ui/`, `smoke/` and `testing/`, plus `theme.ts` and the font helpers.
  A `*.native.ts` / `*.web.ts` pair splits a module by platform; Metro picks
  the file, and the platform-neutral name is what callers import.
- `src/customer-api/` is the data layer: `CustomerApi` wraps
  `makeWorkspaceCustomerApiClient` from `@deskohub/workspace-customer-api`,
  and `customer-data-live.ts` composes it with `CustomerAuthApi`, the platform
  transport, the account-read budget, account scope and session recheck per
  signed-in account. Screens read through these Effect services, never with
  their own `fetch`.
- `messages/*.json` and `project.inlang/` are the Paraglide source (`en-US`
  base, `cs-CZ`); `i18n:compile` writes `src/i18n/paraglide/`, which is
  git-ignored, so compile before Metro, typecheck or tests (the Turbo tasks do
  it).
- `assets/` holds the icons, splash and `assets/fonts/Sculpin.ttf`. Sculpin is a
  variable font whose default weight is 300: pin `fontVariationSettings` to
  the weight a style uses (`src/theme.ts`), or native text renders lighter than
  the design. The web bundle loads the face before the first screen.
- `public/` is the PWA shell for the web export (see
  [web app and Android download](web-app-and-android-page.md)).
- `modules/trusted-web-activity/` is a local Expo module in Kotlin (Android
  Browser Helper): TWA provider detection, launch and release for the sign-in
  page; other platforms get an unsupported stub.
- `plugins/android-asset-statements.cjs` writes the Android
  `asset_statements` resource, the app's half of the Digital Asset Links
  association used by TWA verification and the site's
  `getInstalledRelatedApps()`. `app.json` lists it with the Expo plugins
  (router, localization, splash, font, build-properties with Android min SDK
  28, status bar, image picker).
- `app.config.ts` derives the dynamic config from `app.json`: version code,
  updates URL, update code signing, and the preview App Link filter. It
  imports no local modules, because Expo transpiles only that file; release
  scripts import from it instead.
- `scripts/release/` is the APK release tooling (`deskohub-mobile-release` skill);
  `code-signing/` holds the committed update certificate
  (`deskohub-mobile-release` skill, `references/ota-updates.md`).

## Shared packages

The app's workspace dependencies are `@deskohub/brand-motion`, `brand-tokens`,
`i18n`, `phone-number`, `reservation`, `standard-schema`, `test-email` and
`workspace-customer-api`. Before adding another, check it runs without Node or
Next: the app bundles for Hermes and the browser.

- The root `biome.json` override for `apps/deskohub-mobile/**` bans `next`,
  `next/**`, `@deskohub/next-effect` and `@deskohub/i18n/{next,action,request-locale}`
  through `style/noRestrictedImports`. The `@deskohub/i18n` root, `core`,
  `pathname`, `translatable`, `effect` and `currency` entries are allowed.
  `lint/import-ban.test.ts` pins banned and allowed specifiers; extend both
  when a new server-bound entry appears.
- Hermes lacks some `Intl` APIs. `@deskohub/i18n/currency` falls back to the
  ISO code where `Intl.DisplayNames` is missing; `src/smoke/intl-smoke-cases.ts`
  asserts that on a device. `formatCurrencyAmount` can lose precision on
  Hermes for large decimal strings. Add a smoke case when a shared module
  starts using a newer `Intl` or language API.
- Shared contract and domain code belongs in a package
  (`packages/workspace-customer-api`, `packages/reservation`); never import
  from `apps/deskohub-workspace`.

## Checks

Run from the repository root:

```bash
bun turbo lint typecheck test build:web --filter=deskohub-mobile
```

Mobile CI (`.github/workflows/mobile-ci.yml`) runs the same command on pull
requests and `main` pushes that touch the app, the shared packages in its
`paths` list, or root config. Add a package to that list when the app starts
depending on it. It is
path-filtered and not required, so Workspace validation also runs the
app's tests ([testing and CI](../../deskohub-repository/references/testing-and-ci.md#ci)).
CI builds no native app; the release workflow's PR dry run builds the APK.

- Tests are colocated `*.test.ts(x)` files run by `bun test`; `bunfig.toml`
  preloads `src/testing/native-modules.preload.ts`, which replaces
  `react-native` and the Expo modules with Bun module mocks. Add a mock there
  when a new native module enters a tested import graph. Component tests
  either inspect the element tree (`src/ui/testing/element-tree.ts`) or render
  into happy-dom with `clientRoot()` (`src/testing/client-root.ts`). A
  rendered component that talks to the fake auth server needs
  `clientRoot({ keepFetch: true })`: happy-dom's fetch drops the Cookie
  header.
- `app.config.test.ts` pins the version code, both update-signing shapes, the
  `eas.json` profiles and the preview App Link filter;
  `plugins/android-asset-statements.test.ts` pins the asset statements;
  `scripts/release/*.test.ts` pin the release tooling and workflow.
- Behavior on a device (Hermes, native modules, App Links, Custom Tabs) needs a
  dev client on the emulator: [development build and emulator](dev-build-and-emulator.md).
