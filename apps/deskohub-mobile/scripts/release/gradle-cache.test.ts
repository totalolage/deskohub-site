import { describe, expect, test } from "bun:test";
import {
  gradleCacheKey,
  gradleDistributionName,
  nativeInputsHash,
  nativePackageVersions,
} from "./gradle-cache";

const lockfile = (packages: Record<string, string>) =>
  `{
  "lockfileVersion": 1,
  "workspaces": {},
  "packages": {
${Object.entries(packages)
  .map(
    ([key, resolution]) =>
      `    "${key}": ["${resolution}", "", {}, "sha512-x"],`
  )
  .join("\n")}
  },
}
`;

describe("gradleDistributionName", () => {
  test("reads the distribution from an escaped distributionUrl", () => {
    expect(
      gradleDistributionName(
        "distributionBase=GRADLE_USER_HOME\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip\nnetworkTimeout=10000\n"
      )
    ).toBe("gradle-9.4.1-bin");
  });

  test("refuses properties without a distribution zip", () => {
    expect(() => gradleDistributionName("networkTimeout=10000\n")).toThrow(
      "distributionUrl"
    );
  });
});

describe("nativePackageVersions", () => {
  test("keeps Expo and React Native packages, nested ones included, by resolution", () => {
    expect(
      nativePackageVersions(
        lockfile({
          "@expo/cli": "@expo/cli@58.1.19",
          "@react-native-async-storage/async-storage":
            "@react-native-async-storage/async-storage@2.2.0",
          "@react-native/gradle-plugin": "@react-native/gradle-plugin@0.88.1",
          effect: "effect@4.0.0-beta.85",
          expo: "expo@58.0.23",
          "expo-updates": "expo-updates@58.0.21",
          "expo-updates/arg": "arg@5.0.2",
          "react-native": "react-native@0.88.1",
          "react-native-web/@react-native/normalize-colors":
            "@react-native/normalize-colors@0.74.1",
          "react-native-screens": "react-native-screens@4.30.1",
          "babel-preset-expo": "babel-preset-expo@58.0.4",
        })
      )
    ).toEqual([
      "@expo/cli@58.1.19",
      "@react-native-async-storage/async-storage@2.2.0",
      "@react-native/gradle-plugin@0.88.1",
      "@react-native/normalize-colors@0.74.1",
      "expo-updates@58.0.21",
      "expo@58.0.23",
      "react-native-screens@4.30.1",
      "react-native@0.88.1",
    ]);
  });
});

describe("nativeInputsHash", () => {
  const files = [
    { content: '{"expo":{}}', path: "app.json" },
    { content: "{}", path: "eas.json" },
  ];
  const wrapperProperties =
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-9.4.1-bin.zip\n";
  const base = nativeInputsHash({
    files,
    packageVersions: nativePackageVersions(
      lockfile({ effect: "effect@1.0.0", expo: "expo@58.0.23" })
    ),
    wrapperProperties,
  });

  test("ignores packages outside Expo and React Native and the file order", () => {
    expect(
      nativeInputsHash({
        files: [...files].reverse(),
        packageVersions: nativePackageVersions(
          lockfile({ effect: "effect@2.0.0", expo: "expo@58.0.23" })
        ),
        wrapperProperties,
      })
    ).toBe(base);
  });

  test("changes with an Expo version, a native input file or the wrapper properties", () => {
    expect(
      nativeInputsHash({
        files,
        packageVersions: nativePackageVersions(
          lockfile({ effect: "effect@1.0.0", expo: "expo@58.0.24" })
        ),
        wrapperProperties,
      })
    ).not.toBe(base);
    expect(
      nativeInputsHash({
        files: [files[0], { content: '{"cli":{}}', path: "eas.json" }].filter(
          (file) => file !== undefined
        ),
        packageVersions: nativePackageVersions(
          lockfile({ effect: "effect@1.0.0", expo: "expo@58.0.23" })
        ),
        wrapperProperties,
      })
    ).not.toBe(base);
    expect(
      nativeInputsHash({
        files,
        packageVersions: nativePackageVersions(
          lockfile({ effect: "effect@1.0.0", expo: "expo@58.0.23" })
        ),
        wrapperProperties: `${wrapperProperties}distributionSha256Sum=abc\n`,
      })
    ).not.toBe(base);
  });
});

describe("gradleCacheKey", () => {
  test("names the installed Expo template's Gradle distribution and hashes the app's native inputs", async () => {
    const key = await gradleCacheKey();
    expect(key.gradle).toMatch(/^gradle-\d+(\.\d+)+-(bin|all)$/);
    expect(key.nativeInputs).toMatch(/^[0-9a-f]{64}$/);
  });
});
