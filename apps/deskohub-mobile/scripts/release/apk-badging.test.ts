import { describe, expect, test } from "bun:test";
import { apkIdentity, verifyApkIdentity } from "./apk-badging";

const badging = (versionCode: string, versionName: string) =>
  [
    `package: name='cz.example.app' versionCode='${versionCode}' versionName='${versionName}' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36'`,
    "minSdkVersion:'28'",
    "targetSdkVersion:'36'",
    "application-label:'Example'",
  ].join("\n");

const expected = {
  packageName: "cz.example.app",
  versionCode: 1_002_003,
  versionName: "1.2.3",
};

describe("apkIdentity", () => {
  test("reads the package name and version from badging output", () => {
    expect(apkIdentity(badging("1002003", "1.2.3"))).toEqual(expected);
  });

  test("rejects output without a package line", () => {
    expect(() => apkIdentity("application-label:'Example'")).toThrow();
  });
});

describe("verifyApkIdentity", () => {
  test("accepts an APK with the expected identity", () => {
    expect(verifyApkIdentity(badging("1002003", "1.2.3"), expected)).toEqual(
      expected
    );
  });

  test("names each field that differs", () => {
    expect(() => verifyApkIdentity(badging("1", "1.2.3"), expected)).toThrow(
      "versionCode 1, expected versionCode 1002003"
    );
    expect(() =>
      verifyApkIdentity(badging("1002003", "1.2.4"), expected)
    ).toThrow("versionName 1.2.4");
  });

  test("rejects another package", () => {
    expect(() =>
      verifyApkIdentity(badging("1002003", "1.2.3"), {
        ...expected,
        packageName: "cz.example.other",
      })
    ).toThrow("packageName cz.example.app");
  });
});
