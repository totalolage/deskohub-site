# Deskohub Workspace mobile release runbook

This runbook covers the external configuration required by the checked-in PWA, Android APK, exact-preview, and production-release workflows. The product and API contract is in [MOBILE_SHOP_APP_SPEC.md](./MOBILE_SHOP_APP_SPEC.md).

## Release identities

- Production Android application ID: `cz.deskohub.workspace`
- Production Android scheme: `deskohub-workspace`
- Production PWA/API/App Link origin: `https://app.workspace.deskohub.cz`
- Preview application ID: `cz.deskohub.workspace.preview.p<PR>.s<8-char-sha>`
- Preview scheme: `deskohub-workspace-preview-p<PR>-s<8-char-sha>`
- APK `versionName` and Expo build tag: the exact 40-character Git commit SHA
- APK `versionCode`: the monotonically increasing GitHub Actions run number

Preview packages and signing keys are intentionally disposable, so a preview can be installed beside production and can never upgrade or impersonate it.

## GitHub configuration

Create the protected `workspace-mobile-production` environment with required reviewers and restrict it to `main`. Configure these environment secrets:

- `WORKSPACE_ANDROID_KEYSTORE_BASE64`
- `WORKSPACE_ANDROID_KEYSTORE_PASSWORD`
- `WORKSPACE_ANDROID_KEY_ALIAS`
- `WORKSPACE_ANDROID_KEY_PASSWORD`
- `WORKSPACE_EXPO_UPDATES_CERTIFICATE_BASE64`
- `WORKSPACE_EXPO_UPDATES_PRIVATE_KEY_BASE64`
- `WORKSPACE_EXPO_TOKEN`
- `VERCEL_TOKEN`

Configure these environment variables:

- `WORKSPACE_ANDROID_CERT_SHA256`
- `WORKSPACE_EXPO_PROJECT_ID`
- `WORKSPACE_MOBILE_VERCEL_PROJECT_ID`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`

The permanent Android keystore and Expo update-signing private key must be backed up outside GitHub by the release owner. Never use the preview key for production or rotate the Android key without an explicit key-migration plan.

## Preview APK flow

`.github/workflows/workspace-mobile-preview.yml` accepts only an eligible open internal PR and a successful immutable Vercel Workspace deployment for the exact head SHA. It then waits for that SHA's `Workspace E2E` status, which includes the isolated Neon preview database migration and integration suite.

A privileged job creates a 14-day deployment-scoped Vercel Shareable Link without checking out PR code. The unprivileged build receives only that scoped URL, builds an APK with a PR/SHA-specific package and scheme, verifies the package and full-SHA version tag, and posts the 14-day GitHub artifact link on the PR. Neither a database URL nor the project-wide Vercel bypass secret enters the APK.

The `repository_dispatch` trigger becomes active after this workflow exists on the default branch. `workflow_dispatch` is the controlled recovery path and still verifies the exact GitHub deployment, SHA, branch, and open PR.

## Production flow

`.github/workflows/workspace-mobile-production.yml` starts only after `Deploy Workspace Production` succeeds for a commit on `main`.

The workflow:

1. checks out and verifies the exact deployed SHA;
2. builds `cz.deskohub.workspace` with the permanent key;
3. verifies its application ID, version code, full-SHA version name, and signing-certificate digest;
4. attests the APK and publishes it under immutable tag `deskohub-workspace-android-<sha>`;
5. publishes a signed compatible EAS Update on the production channel;
6. stages the exact APK and signed metadata at `/mobile/android/releases/latest.apk` and `/mobile/android/releases/latest.json` in the production PWA; and
7. deploys the PWA to `app.workspace.deskohub.cz`.

Small JavaScript/asset updates may download on any connection. Native replacement APKs download only on unmetered Wi-Fi and are checked for immutable URL, size, SHA-256, application ID, higher version code, and the compiled production certificate before Android's installer opens.

## External launch checklist

- Point `app.workspace.deskohub.cz` to the dedicated mobile Vercel project rooted at `apps/deskohub-workspace-mobile`.
- Confirm the mobile project rewrites `/api/*` and localized `/auth/*` to the Workspace production deployment.
- Add the canonical production origin and callback paths to Neon Auth's trusted origins/redirects; verify email-link completion in Chrome and the signed APK.
- Provision the Expo project and the signed production update channel; retain the private key only in the protected production environment.
- Register the direct-distribution identity and signing certificate with Android Developer Console, and publish the generated production `/.well-known/assetlinks.json`.
- Configure non-alcoholic Dotypos products with the exact `self-service` tag and verify that exactly one target warehouse is enabled.
- Apply both account and mobile-shop database migrations through the ordinary preview-to-production migration path.
- Confirm Nexi accepts the dedicated mobile-shop notification and return endpoints for both a protected preview and production.
- Approve seller, privacy, non-VAT receipt, refund/support, retention, and Android sideload wording for Desktechub s.r.o.
- Run one physical-device pilot covering magic-link handoff, hosted payment return, receipt delivery, Dotypos deduction, Wi-Fi APK update, unknown-source permission, and signed in-place upgrade.

The source and local CI checks can prove the binary, package, signature, and browser flow. Permanent signing, provider credentials, DNS, a protected preview deployment, and a physical Android device are external release inputs and must not be simulated with production data.
