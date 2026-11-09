# OTA updates

Installed apps receive JavaScript and asset updates from the Workspace's own
Expo Updates server; native changes still need an APK ([release](release.md)).
Server code is in `apps/deskohub-workspace/features/mobile-updates`, the app
side in `apps/deskohub-mobile/src/updates`.

## Server

- `GET /api/mobile/updates/manifest` answers Expo Updates protocol 1 multipart
  responses: the newest update for the request's platform and runtime version,
  a `noUpdateAvailable` directive, or a `rollBackToEmbedded` directive.
  `POST /api/mobile/updates` records a publication and requires
  `MOBILE_UPDATES_PUBLISH_TOKEN`.
- The runtime version uses Expo's `fingerprint` policy: an update reaches only
  builds whose native fingerprint equals the one the publish resolved. The
  fingerprint covers the resolved app config, so `MOBILE_UPDATES_CODE_SIGNING`
  and `EXPO_PUBLIC_API_ORIGIN` (through the updates URL) change it.
- Manifests are signed (`rsa-v1_5-sha256`, key id `main`) with the Workspace
  secret `MOBILE_UPDATES_SIGNING_PRIVATE_KEY`; builds that install updates
  embed the matching certificate,
  `apps/deskohub-mobile/code-signing/code-signing-certificate.pem`.
- Assets go straight from the publisher to public Vercel Blob at
  `mobile-updates/assets/<SHA-256>`, never overwritten and cached for a year,
  so a republish reuses them.
- `mobile_update_publications` is append-only history: the newest row for a
  platform and runtime version wins, so there is no pointer to move. Every
  Neon preview branch has its own history.

## Publishing

The `ota-update` job of `mobile-release.yml` publishes the tagged commit to
production after its release is published. It first checks that the APK's
`assets/fingerprint` equals the runtime version the commit resolves, and fails
instead of publishing an update no build can receive. A failed publish leaves
the release alone; rerun only that job. A JavaScript-only fix therefore ships
as a new patch release. Expo's default fingerprint preset ignores the version
fields, so installed apps of earlier releases get that update whenever nothing
native changed between them; after a native change they keep their old runtime
until the customer installs the new APK, which the update banner offers.

A manual publish runs from `apps/deskohub-workspace`:

```bash
MOBILE_UPDATES_CODE_SIGNING=required \
  bun scripts/publish-mobile-update.ts --project ../deskohub-mobile --target <deployment origin>
```

- It needs `MOBILE_UPDATES_PUBLISH_TOKEN` and `BLOB_READ_WRITE_TOKEN` for the
  target deployment, and `VERCEL_AUTOMATION_BYPASS_SECRET` for a protected
  preview. Set `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_POSTHOG_HOST` and
  `EXPO_PUBLIC_API_ORIGIN` as the target build had them.
- Without `MOBILE_UPDATES_CODE_SIGNING=required` the publish resolves a
  runtime version no release build has.
- `--platform android` (repeatable) limits the platforms; the default is
  Android and iOS. After publishing, the script fetches the manifest as an app
  would and fails unless the deployment serves that update with a signature
  the embedded certificate verifies.
- Publishing to production reaches every customer's app. Do it only through
  a release or with the user's go-ahead.

## Rollback

`--rollback` appends a `rollBackToEmbedded` publication for the resolved
runtime version, with no export and no Blob token: apps on that runtime drop
their downloaded update and run the JavaScript embedded in their APK. The next
normal publish for that runtime version supersedes the rollback. Rolling
forward to an older update means republishing that commit.

## Client

`app/_layout.tsx` mounts `UpdateBanner`. `use-update-prompt.ts` checks on
launch and on returning to the foreground, at most every 15 minutes. On
Android it also reads `GET /api/mobile/releases/latest` and compares its
`versionCode` with the installed build: a newer APK takes precedence and opens
the `/android` page, an OTA update restarts the app on accept, and dismissing
lasts for the session. iOS checks OTA only. `app.config.ts` sets
`checkAutomatically: "ON_ERROR_RECOVERY"`, so updates install only through
this prompt.

Development clients load from Metro and never take OTA updates. To try the
prompt, build a release-shaped APK with `--signing debug` aimed at a preview
and publish to that preview.
