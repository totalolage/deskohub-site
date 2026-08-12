import type { ConfigContext, ExpoConfig } from "expo/config";

const appOrigin = "https://app.workspace.deskohub.cz";
const siteOrigin = "https://workspace.deskohub.cz";
const productionApplicationId = "cz.deskohub.workspace";
const baseVersion = "0.1.0";
const productionReleaseManifestUrl = `${appOrigin}/mobile/android/releases/latest.json`;

const readPositiveInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export default ({ config }: ConfigContext): ExpoConfig => {
  const buildTag = process.env.DW_BUILD_TAG?.trim() || "development";
  const buildChannel =
    process.env.DW_BUILD_CHANNEL === "production" ? "production" : "preview";
  const projectId = process.env.EXPO_PROJECT_ID?.trim();
  const updateCertificatePath =
    process.env.DW_UPDATES_CODE_SIGNING_CERTIFICATE_PATH?.trim();
  const applicationId =
    process.env.DW_ANDROID_APPLICATION_ID?.trim() || productionApplicationId;
  const scheme =
    process.env.DW_APP_SCHEME?.trim() ||
    (buildChannel === "production"
      ? "deskohub-workspace"
      : "deskohub-workspace-preview-p0-s00000000");
  const configuredReleaseManifestUrl =
    process.env.EXPO_PUBLIC_RELEASE_MANIFEST_URL?.trim();
  const releaseManifestUrl =
    configuredReleaseManifestUrl ||
    (buildChannel === "production" ? productionReleaseManifestUrl : undefined);
  const isRelease = /^[0-9a-f]{40}$/.test(buildTag);
  const updatesEnabled =
    buildChannel === "production" &&
    Boolean(projectId && updateCertificatePath);

  return {
    ...config,
    name: "Deskohub Workspace",
    slug: "deskohub-workspace",
    version: isRelease ? buildTag : `${baseVersion}-dev`,
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme,
    userInterfaceStyle: "light",
    runtimeVersion: baseVersion,
    updates: {
      enabled: updatesEnabled,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      requestHeaders: { "expo-channel-name": buildChannel },
      ...(updatesEnabled
        ? {
            url: `https://u.expo.dev/${projectId}`,
            codeSigningCertificate: updateCertificatePath,
            codeSigningMetadata: {
              alg: "rsa-v1_5-sha256",
              keyid: "deskohub-workspace-production",
            },
          }
        : {}),
    },
    android: {
      package: applicationId,
      versionCode: readPositiveInteger(process.env.DW_ANDROID_VERSION_CODE, 1),
      adaptiveIcon: {
        backgroundColor: "#F8F9FA",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png",
      },
      permissions: [
        "android.permission.ACCESS_NETWORK_STATE",
        "android.permission.INTERNET",
        "android.permission.REQUEST_INSTALL_PACKAGES",
      ],
      predictiveBackGestureEnabled: true,
      ...(buildChannel === "production"
        ? {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: true,
                data: [
                  {
                    scheme: "https",
                    host: "app.workspace.deskohub.cz",
                    pathPrefix: "/auth/",
                  },
                  {
                    scheme: "https",
                    host: "app.workspace.deskohub.cz",
                    pathPrefix: "/payment/",
                  },
                ],
                category: ["BROWSABLE", "DEFAULT"],
              },
            ],
          }
        : {}),
    },
    web: {
      bundler: "metro",
      output: "static",
      favicon: "./assets/images/favicon.png",
      name: "Deskohub Workspace",
      shortName: "DW",
      lang: "cs",
      themeColor: "#9C4400",
      backgroundColor: "#F8F9FA",
    },
    plugins: [
      "expo-router",
      "expo-secure-store",
      "expo-updates",
      [
        "expo-splash-screen",
        {
          image: "./assets/images/splash-icon.png",
          imageWidth: 180,
          resizeMode: "contain",
          backgroundColor: "#F8F9FA",
        },
      ],
      [
        "expo-build-properties",
        {
          android: {
            compileSdkVersion: 36,
            targetSdkVersion: 36,
            minSdkVersion: 24,
          },
        },
      ],
      "./plugins/with-android-release-signing.cjs",
      "./plugins/with-app-updater.cjs",
    ],
    experiments: {
      typedRoutes: true,
    },
    extra: {
      ...config.extra,
      appOrigin,
      siteOrigin,
      applicationId,
      scheme,
      buildTag,
      buildChannel,
      apiOrigin: process.env.EXPO_PUBLIC_API_ORIGIN ?? appOrigin,
      androidCertificateSha256: process.env.DW_ANDROID_CERT_SHA256?.trim()
        .replaceAll(":", "")
        .toLowerCase(),
      ...(releaseManifestUrl ? { releaseManifestUrl } : {}),
      ...(projectId ? { eas: { projectId } } : {}),
    },
  };
};
