---
name: deskohub-mobile-release
description: Mobile release, Android APK, mobile-v tag, mobile-release.yml, versionCode, expo.version bump, mobile CHANGELOG, release signing keystore, apksigner fingerprint, eas build --local, release-shaped debug-signed APK, latest Android release lookup, /api/mobile/releases/latest, loadLatestAndroidRelease, GitHub API rate limit, first public release, Sculpin brand font licence, physical-device release checklist, update code signing, MOBILE_UPDATES_CODE_SIGNING, OTA update, publish-mobile-update.ts, Expo Updates server, rollback, fingerprint runtime version.
---

# Deskohub mobile release

`.github/workflows/mobile-release.yml` builds the release-signed APK with `eas build --local` and publishes it as the GitHub Release `mobile: vX.Y.Z` with the asset `deskohub-X.Y.Z.apk`. CI and local builds both run `apps/deskohub-mobile/scripts/release/mobile-release.ts`; change the build there, not in the workflow. OTA publishing and rollback are in [OTA updates](references/ota-updates.md). App layout, dev clients, the emulator, `/app/`, auth and analytics are in the `deskohub-mobile` skill.

## Versions

- `expo.version` in `apps/deskohub-mobile/app.json` is the one version source. `app.config.ts` derives `android.versionCode` from it as `major * 1_000_000 + minor * 1_000 + patch` (minor and patch below 1000, major below 2100), so a later version always installs over an earlier one. Keep `appVersionSource: local` in `eas.json`.
- Versions are plain `X.Y.Z`; the tag is `mobile-vX.Y.Z`, mirroring dhw's `dhw-vX.Y.Z`.
- `app.config.ts` imports no local modules: Expo transpiles only that file, so a TypeScript import from it fails on Node without type stripping. Release scripts import from it instead.

## Brand font licence

The app embeds the site's Sculpin face: `apps/deskohub-mobile/assets/fonts/Sculpin.ttf` is a copy of the site's `regular.ttf`, linked by the `expo-font` plugin entry in `app.json`. The user decided on 2026-11-07 to embed it now and to obtain the app-embedding licence manually before the first public release. Before cutting that release, ask the user to confirm the licence is in place.

## Cutting a release

1. On a branch, bump `expo.version` and add a section to `apps/deskohub-mobile/CHANGELOG.md` in dhw's Release Please layout (see `apps/dhw/CHANGELOG.md`): `## [X.Y.Z](https://github.com/totalolage/deskohub-site/compare/mobile-vPREVIOUS...mobile-vX.Y.Z) (YYYY-MM-DD)`, then `### Features` and `### Bug Fixes` lists of Conventional Commit subjects. Merge it to `main`.
2. Tag the merged commit and push the tag: `git tag mobile-vX.Y.Z <main sha> && git push origin mobile-vX.Y.Z`.
3. The workflow stops before secrets are used unless the tag matches `expo.version`, the CHANGELOG section exists, and the commit is on `main`. It then builds, checks the APK's package, version name and version code with `aapt2`, checks every signer against the release certificate with `apksigner`, attests provenance, and publishes the release. The release notes are the CHANGELOG section plus the APK and certificate SHA-256 (`renderReleaseNotes` in `scripts/release/release-notes.ts`).

Published releases are immutable: a rerun resumes a draft and leaves a published release alone, so fix a bad release with a new version. Mobile releases are published with `--latest=false`, so dhw stays the repository's latest release; link mobile downloads by tag, not `releases/latest`.

## Pull request dry runs

Pull requests touching `apps/deskohub-mobile/**` or the workflow run the build job without a tag and with `--signing debug`: the script generates a throwaway keystore with `keytool`, signs with it, fails if the release certificate signed the APK, and uploads the APK as the `deskohub-mobile-apk` workflow artifact. Only the tag build step reads `ANDROID_KEYSTORE_BASE64` and `ANDROID_KEYSTORE_PASSWORD`, and it runs only on `push`; `scripts/release/mobile-release-workflow.test.ts` fails when a step that reads them loses that condition, or when the two build steps' env differs apart from the keystore. The build job runs `bun test scripts/release` before building, because Mobile CI (`mobile-ci.yml`) doesn't trigger on a change to `mobile-release.yml` alone. A pull request runs its own copy of the workflow, so these conditions prevent mistakes, not a branch that edits them. Fork pull requests skip the job because they get no `EXPO_TOKEN`. Tag runs use the `mobile-release` GitHub environment, which only `mobile-v*` tags may deploy to: it holds the release keystore, the environment's `EXPO_TOKEN` (which overrides the repository's), and the OTA job's `MOBILE_UPDATES_PUBLISH_TOKEN` and `BLOB_READ_WRITE_TOKEN`. Pull request runs get an empty environment and the repository's `EXPO_TOKEN`. The job log prints the `apksigner` signer lines and the job summary shows the release notes.

Dry runs cache `~/.gradle/caches` and `~/.gradle/wrapper`. The key is `mobile-gradle-<os>-<arch>-<distribution>-<hash>`: `mobile-release.ts gradle-cache-key` (`scripts/release/gradle-cache.ts`) reads the distribution from the wrapper properties in the installed `expo` package's prebuild template, and hashes those wrapper properties, `app.json`, `app.config.ts`, `eas.json`, `plugins/`, the local modules' Android files and the bun.lock versions of the Expo and React Native packages. Other bun.lock changes keep the key. A pull request can restore only its own entries and `main`'s, so `mobile-gradle-cache.yml` writes `main`'s entry under the same key on pushes to `main` that touch the app or `bun.lock`, twice a week (GitHub evicts entries unused for seven days), and on manual dispatch: `mobile-release.ts resolve-gradle-dependencies` runs `expo prebuild` with the production profile's env and downloads every resolvable configuration through `scripts/release/resolve-dependencies.init.gradle`, without building, then removes `android/`. That entry has the downloads but not the build's transforms. A dry run whose key matches `main`'s restores it and saves nothing; one whose native inputs changed restores the closest earlier entry and, after a successful build, saves its own (about 1.6 GB compressed), once a step has checked that the cached paths hold no `gradle.properties`, `credentials.json` or keystore. Pull requests that change the warm-up run it without a cache and save nothing. Tag builds skip the cache entirely. Before either build, `mobile-release.ts prepare-gradle` (`scripts/release/gradle-wrapper.ts`, tag builds included) downloads the distribution those wrapper properties name with `curl --retry`, checks it against Gradle's published `.sha256`, and puts it where the wrapper looks (`~/.gradle/wrapper/dists/<name>/<base36 MD5 of the URL>/`), because the wrapper's own download has a 10 s timeout and no retry. `services.gradle.org` gets three quick attempts; when it fails, the zip comes from the GitHub release `gradle/gradle-distributions` and the SHA-256 from `downloads.gradle.org`'s `.sha256`, else from the asset digest GitHub's API lists (the GitHub release has no `.sha256` files). A host that failed once isn't asked again, only a file's last source gets the full retries (`curlLimits` in `gradle-wrapper.ts`), and curl prints the redirect hop that failed. The step's last log line names the URLs that served the zip and the checksum; a checksum mismatch fails without a fallback. It also appends higher retry and HTTP timeout `systemProp`s for dependency downloads to `~/.gradle/gradle.properties`, which the cache leaves out. A Gradle "Could not GET" that outlasts those retries is a download outage: rerun it.

## Local build

Run from `apps/deskohub-mobile` with the Android SDK (`ANDROID_HOME`), JDK 17, NDK 27.1.12297006 and Node 22 or later:

```bash
EXPO_TOKEN=... ANDROID_KEYSTORE_PATH=<release.keystore> ANDROID_KEYSTORE_PASSWORD=... \
  bun run release:apk --out-dir <dir>
```

`ANDROID_KEYSTORE_BASE64` replaces `ANDROID_KEYSTORE_PATH` in CI. Without the release keystore, `bun run release:apk --signing debug --out-dir <dir>` builds the same APK signed with a throwaway key (JDK `keytool` from `JAVA_HOME` or `PATH`); it refuses `--tag`. The script writes `credentials.json` (git-ignored) for the build and removes it afterwards; it refuses to run when one already exists. It sets `GRADLE_OPTS=-Dorg.gradle.daemon=false -Dorg.gradle.workers.max=4` unless `GRADLE_OPTS` is set, because a Gradle daemon killed mid-build on a shared machine fails the build with "Gradle build daemon disappeared". EAS works in the system temporary directory, so point `TMPDIR` at a disk with room for a full Android build.

The `--signing debug` build is the release-shaped dry run: production profile, update signing on, all four ABIs. Locally it takes about 12 minutes and gives an APK of about 111 MB. It is what to install for checks that need release behavior short of the release key (update signing, the production "no update" answer, cold start); everything that trusts the release certificate fails on it by design (see the checklist below). To point one at a preview, see the `deskohub-mobile` skill's `references/dev-build-and-emulator.md`.

The script builds with `bunx eas-cli@27.5.0 build --platform android --profile production --local --non-interactive`. Like CI, set `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` for an APK that sends analytics (without them analytics stay off), and `EXPO_PUBLIC_API_ORIGIN` only for a build aimed at a preview. `EXPO_PUBLIC_API_ORIGIN` feeds the fingerprint runtime version through the updates URL, and an OTA bundle exported without the PostHog values turns analytics off, so a publish for that APK uses the same values ([OTA updates](references/ota-updates.md)).

The release certificate SHA-256 is `releaseCertificateSha256` in `scripts/release/apk-signature.ts`; `/.well-known/assetlinks.json` and the passkey `android:apk-key-hash` origin use the same key.

## Physical-device checklist

The emulator and debug-signed builds can't show these; check them with the
tagged APK on a physical Android device after the first release, and hand the
list to the user when an agent can't:

- A magic link or `/app/` link opens the app directly (verified App Link with
  the release certificate).
- The OTA "update ready, restart" banner after a published update, and the
  native-update prompt and Download link against a real `mobile-v` release.
- An OTA rollback (`--rollback`) after a published update: the Restart banner
  returns the app to its embedded update, and a dismissed one applies at the
  next cold start.
- The live Obtainium badge and import on `/android`.
- Creating and signing in with a passkey through the device's credential
  provider.
- The link-only "sent" screen with the `login_email_code` flag off.
- TalkBack across sign-in, booking and the account screens; iOS once an Apple
  account exists.

## Update code signing and development clients

`app.config.ts` embeds the update code-signing certificate (`code-signing/code-signing-certificate.pem`, keyid `main`) only when `MOBILE_UPDATES_CODE_SIGNING=required`; unset or empty leaves it out, and any other value fails the config. The `production` profile in `eas.json` sets it, so every release, dry-run and `release:apk` build verifies update signatures. The `ota-update` job sets it as job env for the runtime-version check and the publish: the signing fields feed the fingerprint runtime version, so a publish without the variable resolves a runtime no release has. Set it for a manual `publish-mobile-update.ts` run too. `app.config.test.ts` pins both config shapes and the two `eas.json` profiles; `mobile-release-workflow.test.ts` pins the `ota-update` job env to the production profile's env.

Development clients and Metro run without it. A build that embeds the certificate asks Metro for a signed development manifest, and Metro refuses with "Must specify --private-key-path argument to sign development manifest" unless started with the private key; never point Metro at the key. Build dev clients with the variable unset (`deskohub-mobile` skill, `references/dev-build-and-emulator.md`).

## Latest-release endpoint

`GET /api/mobile/releases/latest` tells the app, and the `/android` page through `loadLatestAndroidRelease`, which APK is the newest. The code is in `apps/deskohub-workspace/features/mobile-releases`: the release-note rules in `android-release.ts`, and the cached lookup in `backend/latest-android-release.server.ts`. It answers the release as JSON, 404 `{ "error": "no-release" }`, or an uncached 502 `{ "error": "lookup-failed" }`.

- It reads GitHub's REST API without a token: `git/matching-refs/tags/mobile-v`, then `releases/tags/<tag>` for the three highest versions until one is usable. A 404 there means the tag has no published release yet. Paging the release list could miss mobile releases behind dhw releases; the tag list can't.
- A release counts only if `renderReleaseNotes` wrote it: tag `mobile-vX.Y.Z`, title `mobile: vX.Y.Z`, asset `deskohub-X.Y.Z.apk`, and an `### Android APK` section whose `File` line names that asset with its version code, with a `File SHA-256` line and a `Signing certificate SHA-256` line equal to `nativeApp.androidReleaseCertificate` (`features/account/backend/auth/native-app.ts`). Change `android-release.ts` with any change to those lines. Keep `nativeApp.androidReleaseCertificate` equal to `releaseCertificateSha256` in `scripts/release/apk-signature.ts`.
- Unauthenticated requests are limited to 60 an hour per IP address, and Vercel functions share egress addresses. The lookup is shared with `"use cache: remote"` for ten minutes, and a lookup takes two requests in the usual case. A failed lookup, including a refresh of a good result, is shared for two minutes as a failure, never as "no release", and never thrown, because a throwing cached function fails the `/android` prerender. During a GitHub outage the route answers 502 and `/android` shows no download until a lookup succeeds. If the three highest `mobile-v` tags have no usable release while older tags exist, the lookup fails instead of reporting none: publish or fix those releases. The route sends `s-maxage=600, stale-while-revalidate=3600` on 200 and 404 and `no-store` on 502. A spell of 502s with `mobile_releases.latest_android.lookup_failed` logged usually means the rate limit is spent; it clears within the hour.
