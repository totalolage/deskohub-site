# Web app and Android download

## `/app/` web app

The same Expo Router code exports to a static single-page web app that the
Workspace serves at `workspace.deskohub.cz/app/` as the installable PWA. It
shares the site's origin, so it uses the site's session cookie and consent
cookie directly.

- `app.json` sets `web.output: "single"` and `experiments.baseUrl: "/app"`.
  `build:web` (`expo export --platform web`) writes `dist/`.
- `apps/deskohub-workspace` task `mobile-web-app:build`
  (`features/mobile-web-app/build-mobile-web-app.ts`) depends on
  `deskohub-mobile#build:web` and replaces the git-ignored `public/app/` with
  the export. `build:compile` depends on it, so the export is in place before
  `next build`. The Workspace lists the app as a dependency only so a mobile
  change redeploys it.
- `next.config.mjs` rewrites undotted `/app/*` paths to `/app/index.html`,
  sends `X-Robots-Tag: noindex` for `/app/`, and the shell's `index.html` has
  a noindex meta too. `proxy.ts` sends `/app/` past the locale rewrite and
  redirects bare `/app` to `/app/` (308). `vercel.json` caches only the hashed
  `/app/_expo/static/*` files as immutable.
- `public/` in the app is the PWA shell: `index.html`, `manifest.webmanifest`
  (`id`, `start_url` and `scope` all `/app/`, `related_applications` naming the
  Android app), `sw.js` (network-first navigations with an offline page) and
  `offline.html`. The site's locale layout links `/app/manifest.webmanifest`
  from every page. Keep the manifest `id` fixed: a new id is a different app to
  installed PWAs.
- Leave `EXPO_PUBLIC_API_ORIGIN` unset for the web export: the bundle then
  uses the origin that served it. A set value wins and would move the API off
  the session cookie's origin.

To try it locally, build the export into the Workspace and start it:

```bash
bun turbo mobile-web-app:build --filter=deskohub-workspace
bun run --cwd apps/deskohub-workspace dev
```

Then open `http://localhost:3000/app/`. Rerun the first command after app
changes; the Workspace dev server doesn't watch the app. On a preview, the PWA
is at `<preview origin>/app/` behind the usual deployment protection.

## `/android` page and Obtainium

- `/{locale}/android`
  (`apps/deskohub-workspace/app/[locale]/(site)/(full-header)/android/page.tsx`)
  offers the latest APK, install guidance, the signing certificate
  fingerprint and an Obtainium link. It reads the release through
  `loadLatestAndroidRelease` (`deskohub-mobile-release` skill, latest-release
  endpoint).
- `features/mobile-distribution/obtainium-link.ts` builds
  `https://apps.obtainium.imranr.dev/redirect?r=<encoded obtainium://app JSON>`
  that tracks the GitHub releases and matches assets named
  `deskohub-X.Y.Z.apk` from `mobile-v` tags. Keep the asset name and tag
  pattern in step with the release tooling.
- On Android, `install-environment.ts` calls `getInstalledRelatedApps()`; when
  the app is installed, the footer offers to open it
  (`install-android-app.ts`: an `intent://` URL into the app, falling
  back to `/android`). Detection needs both halves of the association: the
  manifest's `related_applications` plus `/.well-known/assetlinks.json` on the
  site, and the app's `asset_statements` resource
  (`plugins/android-asset-statements.cjs`).
