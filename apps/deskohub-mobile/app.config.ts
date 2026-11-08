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
//
// The update manifest lives on the Workspace the app talks to, so
// `EXPO_PUBLIC_API_ORIGIN` points a build's updates at a preview too.
// `updatesManifestUrl` repeats the origin rules of `src/auth/api-origin.ts`
// for that reason; app.config.test.ts keeps the two in step. The manifest URL
// feeds the fingerprint runtime version, so publish an update with the same
// `EXPO_PUBLIC_API_ORIGIN` the build used.

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

const productionApiOrigin = "https://workspace.deskohub.cz";
const plainHttpHosts = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

export const updatesManifestUrl = (configured: string | undefined): string => {
  const candidate = configured?.trim() || productionApiOrigin;
  const url = URL.parse(candidate);
  const allowed =
    url !== null &&
    (url.protocol === "https:" ||
      (url.protocol === "http:" && plainHttpHosts.has(url.hostname)));
  if (!allowed) {
    throw new Error(
      `EXPO_PUBLIC_API_ORIGIN must be an absolute https URL (plain http only for a local host), got ${JSON.stringify(candidate)}.`
    );
  }
  return `${url.origin}/api/mobile/updates/manifest`;
};

// A build that embeds the code-signing certificate accepts only signed
// manifests. A development client built that way asks Metro for a signed
// development manifest, which Metro serves only with the private key, so the
// certificate goes only into builds that install updates. They set
// `MOBILE_UPDATES_CODE_SIGNING=required`: the production profile in eas.json
// does for every APK build, and the release workflow's ota-update job does for
// the update publish. The signing fields feed the fingerprint runtime version,
// so a publish without the setting targets no installed release.
type UpdatesCodeSigning = Pick<
  NonNullable<ExpoConfig["updates"]>,
  "codeSigningCertificate" | "codeSigningMetadata"
>;

const updatesCodeSigning = (
  setting: string | undefined
): UpdatesCodeSigning => {
  if (setting === undefined || setting === "") return {};
  if (setting !== "required") {
    throw new Error(
      `MOBILE_UPDATES_CODE_SIGNING must be "required" or unset, got ${JSON.stringify(setting)}.`
    );
  }
  return {
    codeSigningCertificate: "./code-signing/code-signing-certificate.pem",
    codeSigningMetadata: { keyid: "main", alg: "rsa-v1_5-sha256" },
  };
};

// app.json links only the production host's /app/ paths to the app. A
// development build pointed at a preview (`EXPO_PUBLIC_API_ORIGIN`) also
// claims that host's /app/ paths, so a sign-in email from the preview opens
// the app. The filter isn't verified: a tester approves the host on the
// device. A production build never gets it.
const productionHost = new URL(productionApiOrigin).hostname;

type AndroidIntentFilter = NonNullable<
  NonNullable<ExpoConfig["android"]>["intentFilters"]
>[number];

const developmentAppLinkFilters = (
  env: Readonly<Record<string, string | undefined>>
): AndroidIntentFilter[] => {
  const configured = env.EXPO_PUBLIC_API_ORIGIN?.trim();
  if (!configured || env.EAS_BUILD_PROFILE === "production") return [];
  const url = URL.parse(configured);
  if (
    url === null ||
    url.protocol !== "https:" ||
    url.hostname === productionHost
  ) {
    return [];
  }
  return [
    {
      action: "VIEW",
      autoVerify: false,
      data: [{ scheme: "https", host: url.hostname, pathPrefix: "/app/" }],
      category: ["BROWSABLE", "DEFAULT"],
    },
  ];
};

export default (
  { config }: ConfigContext,
  env: Readonly<Record<string, string | undefined>> = process.env
): ExpoConfig => ({
  ...config,
  name: config.name ?? "Deskohub",
  slug: config.slug ?? "deskohub-mobile",
  android: {
    ...config.android,
    versionCode: androidVersionCode(config.version),
    intentFilters: [
      ...(config.android?.intentFilters ?? []),
      ...developmentAppLinkFilters(env),
    ],
  },
  // Updates apply only in release builds; debug and dev-client builds load
  // JS from Metro. The app checks on launch and foreground itself
  // (src/updates), so the native launch check runs only to recover from a
  // crashing update, and launch never waits for the network.
  updates: {
    enabled: true,
    url: updatesManifestUrl(env.EXPO_PUBLIC_API_ORIGIN),
    checkAutomatically: "ON_ERROR_RECOVERY",
    fallbackToCacheTimeout: 0,
    ...updatesCodeSigning(env.MOBILE_UPDATES_CODE_SIGNING),
  },
});
