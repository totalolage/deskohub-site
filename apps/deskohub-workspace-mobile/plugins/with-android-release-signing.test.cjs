const { describe, expect, test } = require("bun:test");
const { applySigning } = require("./with-android-release-signing.cjs");

const buildGradle = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}`;

describe("Android release signing config plugin", () => {
  test("adds a release key without changing debug signing", () => {
    const result = applySigning(buildGradle);

    expect(result).toContain('System.getenv("DW_ANDROID_KEYSTORE_PATH")');
    expect(result).toContain(`debug {
            signingConfig signingConfigs.debug
        }`);
    expect(result).toContain(`release {
            signingConfig signingConfigs.release
        }`);
  });

  test("is idempotent", () => {
    const once = applySigning(buildGradle);
    expect(applySigning(once)).toBe(once);
  });
});
