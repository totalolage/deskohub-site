const { AndroidConfig, withAndroidManifest, withDangerousMod } = require("expo/config-plugins");
const fs = require("node:fs/promises");
const path = require("node:path");

const providerName = "androidx.core.content.FileProvider";

module.exports = (config) => {
  config = withAndroidManifest(config, (androidConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      androidConfig.modResults,
    );
    application.provider ??= [];

    if (!application.provider.some((provider) => provider.$?.["android:name"] === providerName)) {
      application.provider.push({
        $: {
          "android:name": providerName,
          "android:authorities": "${applicationId}.deskohub_updates",
          "android:exported": "false",
          "android:grantUriPermissions": "true",
        },
        "meta-data": [
          {
            $: {
              "android:name": "android.support.FILE_PROVIDER_PATHS",
              "android:resource": "@xml/deskohub_update_paths",
            },
          },
        ],
      });
    }

    return androidConfig;
  });

  return withDangerousMod(config, ["android", async (androidConfig) => {
    const xmlDirectory = path.join(
      androidConfig.modRequest.platformProjectRoot,
      "app/src/main/res/xml",
    );
    await fs.mkdir(xmlDirectory, { recursive: true });
    await fs.writeFile(
      path.join(xmlDirectory, "deskohub_update_paths.xml"),
      '<?xml version="1.0" encoding="utf-8"?>\n<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="updates" path="deskohub-updates/" /></paths>\n',
    );
    return androidConfig;
  }]);
};
