import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json holds the static config, and its `expo.version` is the app's one
// version source. Android orders installs by an integer version code, so each
// version maps to one code: major * 1_000_000 + minor * 1_000 + patch. With
// minor and patch below 1000 and major below 2100, a later version always gets
// a larger code, and the largest stays under Android's 2_100_000_000 limit.
//
// This file imports no local modules: Expo transpiles only app.config.ts
// itself, and Node versions without type stripping can't load a TypeScript
// import from it.

export type AppVersion = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
};

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const majorLimit = 2100;
const componentLimit = 1000;

export const parseAppVersion = (version: string): AppVersion => {
  const match = versionPattern.exec(version);
  if (match === null) {
    throw new Error(
      `App version ${JSON.stringify(version)} must be MAJOR.MINOR.PATCH without a prefix, pre-release or build suffix.`
    );
  }
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (
    major >= majorLimit ||
    minor >= componentLimit ||
    patch >= componentLimit
  ) {
    throw new Error(
      `App version ${version} must keep MAJOR below ${majorLimit} and MINOR and PATCH below ${componentLimit} to fit the Android version code.`
    );
  }
  return { major, minor, patch };
};

export const androidVersionCode = (version: string | undefined): number => {
  if (version === undefined) {
    throw new Error(
      "The Expo config has no version to derive the Android version code from."
    );
  }
  const { major, minor, patch } = parseAppVersion(version);
  const code = major * 1_000_000 + minor * 1000 + patch;
  if (code === 0) {
    throw new Error("App version 0.0.0 has no positive Android version code.");
  }
  return code;
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? "Deskohub",
  slug: config.slug ?? "deskohub-mobile",
  android: {
    ...config.android,
    versionCode: androidVersionCode(config.version),
  },
});
