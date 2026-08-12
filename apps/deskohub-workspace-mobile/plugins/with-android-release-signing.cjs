const { withAppBuildGradle } = require("expo/config-plugins");

const signingBlock = `
        release {
            def keyStorePath = System.getenv("DW_ANDROID_KEYSTORE_PATH")
            if (keyStorePath) {
                storeFile file(keyStorePath)
                storePassword System.getenv("DW_ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("DW_ANDROID_KEY_ALIAS")
                keyPassword System.getenv("DW_ANDROID_KEY_PASSWORD")
            }
        }
`;

const applySigning = (source) => {
  if (source.includes("DW_ANDROID_KEYSTORE_PATH")) return source;

  const signingConfigsEnd = /signingConfigs\s*\{([\s\S]*?)\n\s{4}\}/;
  const withReleaseConfig = source.replace(signingConfigsEnd, (match, body) =>
    match.replace(body, `${body}${signingBlock}`),
  );

  if (withReleaseConfig === source) {
    throw new Error("Could not locate Android signingConfigs block");
  }

  return withReleaseConfig.replace(
    /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
    "$1signingConfig signingConfigs.release",
  );
};

module.exports = (config) =>
  withAppBuildGradle(config, (androidConfig) => {
    if (androidConfig.modResults.language !== "groovy") {
      throw new Error("Deskohub Android signing expects a Groovy build.gradle");
    }
    androidConfig.modResults.contents = applySigning(androidConfig.modResults.contents);
    return androidConfig;
  });

module.exports.applySigning = applySigning;
