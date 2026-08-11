#!/usr/bin/env bash
set -euo pipefail

required_environment=(
  DW_ANDROID_APPLICATION_ID
  DW_ANDROID_KEYSTORE_PASSWORD
  DW_ANDROID_KEYSTORE_PATH
  DW_ANDROID_KEY_ALIAS
  DW_ANDROID_KEY_PASSWORD
  DW_ANDROID_VERSION_CODE
  DW_BUILD_CHANNEL
  DW_BUILD_TAG
  EXPO_PUBLIC_API_ORIGIN
)

for name in "${required_environment[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required environment variable: $name" >&2
    exit 1
  fi
done

if [[ "$DW_BUILD_CHANNEL" == "production" ]]; then
  production_environment=(
    DW_ANDROID_CERT_SHA256
    DW_UPDATES_CODE_SIGNING_CERTIFICATE_PATH
    EXPO_PROJECT_ID
  )
  for name in "${production_environment[@]}"; do
    if [[ -z "${!name:-}" ]]; then
      echo "Production builds require environment variable: $name" >&2
      exit 1
    fi
  done
fi

if [[ ! "$DW_BUILD_TAG" =~ ^[0-9a-f]{40}$ ]]; then
  echo "DW_BUILD_TAG must be a full lowercase Git commit SHA" >&2
  exit 1
fi

if [[ ! "$DW_ANDROID_APPLICATION_ID" =~ ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$ ]]; then
  echo "DW_ANDROID_APPLICATION_ID is not a valid Android application ID" >&2
  exit 1
fi

output_name="${1:-deskohub-workspace.apk}"
output_directory="$PWD/dist/android"

bunx expo prebuild --platform android --clean --no-install
(
  cd android
  ./gradlew --no-daemon --stacktrace :app:assembleRelease
)

mkdir -p "$output_directory"
cp android/app/build/outputs/apk/release/app-release.apk "$output_directory/$output_name"

if command -v apksigner >/dev/null 2>&1; then
  apksigner verify --verbose --print-certs "$output_directory/$output_name"
fi

echo "$output_directory/$output_name"
